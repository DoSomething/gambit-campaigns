'use strict';

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;

const logger = rootRequire('lib/logger');
const gambitJunior = rootRequire('lib/gambit-junior');

/**
 * Returns a bot model for given endpoint and data.
 */
function cacheBot(endpoint, gambitJuniorBot) {
  logger.debug(`locals.cacheBot endpoint:${endpoint} id:${gambitJuniorBot.id}`);

  const data = gambitJuniorBot;
  data._id = Number(gambitJuniorBot.id);
  data.id = undefined;

  return app.locals.db[endpoint]
    .findOneAndUpdate({ _id: data._id }, data, { upsert: true, new: true })
    .exec();
}

/**
 * Find model for given bot type/id.
 */
function findBot(endpoint, id) {
  logger.debug(`locals.findBot endpoint:${endpoint} id:${id}`);

  return app.locals.db[endpoint]
    .findById(id)
    .exec();
}

/**
 * Gets given bot type/id from Gambit Jr API and returns cached model.
 */
function getBot(endpoint, id) {
  logger.debug(`locals.getBot endpoint:${endpoint} id:${id}`);

  return gambitJunior
    .get(endpoint, id)
    .then(bot => cacheBot(endpoint, bot))
    .catch((err) => {
      logger.error(err);

      return null;
    });
}

/**
 * Upserts given Phoenix campaign to campaign model, saves to app.locals.campaign[campaign.id].
 */
function loadCampaign(campaign) {
  logger.debug(`loadCampaign:${campaign.id}`);

  const data = {
    status: campaign.status,
    tagline: campaign.tagline,
    title: campaign.title,
    msg_rb_confirmation: campaign.reportbackInfo.confirmationMessage,
    rb_noun: campaign.reportbackInfo.noun,
    rb_verb: campaign.reportbackInfo.verb,
  };

  return app.locals.db.campaigns
    .findOneAndUpdate({ _id: campaign.id }, data, { upsert: true, new: true })
    .exec()
    .then((campaignDoc) => {
      if (!campaignDoc) {
        return null;
      }

      app.locals.campaigns[campaign.id] = campaignDoc;
      logger.debug(`loaded app.locals.campaigns[${campaignDoc._id}]`);

      if (campaignDoc.keywords) {
        campaignDoc.keywords.forEach((campaignKeyword) => {
          const keyword = campaignKeyword.toLowerCase();
          app.locals.keywords[keyword] = campaign.id;
          logger.debug(`loaded app.locals.keyword[${keyword}]:${campaign.id}`);
        });
      } else {
        logger.warn(`keywords undefined for campaign:${campaign.id} `);
      }

      return campaignDoc;
    })
    .catch(err => logger.error(err));
}

/**
 * Returns object of Mongoose api models for given connection, indexed by collection name.
 */
module.exports.getModels = function (conn) {
  const models = {};
  // Indexed by collection name:
  models.campaigns = rootRequire('api/models/Campaign')(conn);
  models.campaignbots = rootRequire('api/models/CampaignBot')(conn);
  models.donorschoosebots = rootRequire('api/models/DonorsChooseBot')(conn);
  models.donorschoose_donations = rootRequire('api/models/DonorsChooseDonation')(conn);
  models.reportback_submissions = rootRequire('api/models/ReportbackSubmission')(conn);
  models.signups = rootRequire('api/models/Signup')(conn);
  models.users = rootRequire('api/models/User')(conn);
  // TBDeleted
  models.legacyReportbacks = rootRequire('api/legacy/reportback/reportbackModel')(conn);

  return models;
};

/**
 * Returns authenticated Northstar JS client.
 */
module.exports.getNorthstarClient = function () {
  const NorthstarClient = require('@dosomething/northstar-js');

  return new NorthstarClient({
    baseURI: process.env.DS_NORTHSTAR_API_BASEURI,
    apiKey: process.env.DS_NORTHSTAR_API_KEY,
  });
};

/**
 * Returns authenticated Phoenix JS client.
 */
module.exports.getPhoenixClient = function () {
  const PhoenixClient = require('@dosomething/phoenix-js');

  return new PhoenixClient({
    baseURI: process.env.DS_PHOENIX_API_BASEURI,
    username: process.env.DS_PHOENIX_API_USERNAME,
    password: process.env.DS_PHOENIX_API_PASSWORD,
  });
};

/**
 * Gets given bot from API, or loads from cache if error.
 */
module.exports.loadBot = function (endpoint, id) {
  logger.debug(`locals.loadBot endpoint:${endpoint} id:${id}`);

  return getBot(endpoint, id)
    .then((bot) => {
      if (!bot) {
        logger.debug('getBot undefined');

        return findBot(endpoint, id);
      }

      return bot;
    });
};

/**
 * Loads app.locals.campaigns from DS API.
 */
module.exports.loadCampaigns = function () {
  app.locals.campaigns = {};
  app.locals.keywords = {};

  const campaignIds = process.env.CAMPAIGNBOT_CAMPAIGNS;
  logger.debug(`loadCampaigns:${campaignIds}`);

  return app.locals.clients.phoenix.Campaigns
    .index({ ids: campaignIds })
    .then((campaigns) => {
      logger.debug(`loadCampaigns found ${campaigns.length} campaigns`);

      return campaigns.map(campaign => loadCampaign(campaign));
    });
};

/**
 * Legacy config models.
 */

/**
 * Returns object with a data property, containing a hash map of models for modelName by model id.
 */
function getLegacyModelMap(configName, model) {
  logger.verbose(`loading ${configName}`);

  const modelMap = {};

  return model.find({}).exec().then((docs) => {
    docs.forEach((doc) => {
      if (configName === 'legacyReportbacks') {
        // Legacy reportback controller loads its config based by endpoint instead of _id.
        modelMap[doc.endpoint] = doc;
      } else {
        modelMap[doc._id] = doc;
      }
    });

    return {
      name: configName,
      count: docs.length,
      data: modelMap,
    };
  });
}

/**
 * Loads map of config content as app.locals.configs object instead using Mongoose find queries.
 */
module.exports.loadLegacyConfigs = function () {
  const uri = process.env.CONFIG_DB_URI || 'mongodb://localhost/config';
  const conn = mongoose.createConnection(uri);

  /* eslint-disable max-len*/
  const models = {
    legacyReportbacks: rootRequire('api/legacy/reportback/reportbackConfigModel')(conn),
    legacyStartCampaignTransitions: rootRequire('api/legacy/ds-routing/config/startCampaignTransitionsConfigModel')(conn),
    legacyYesNoPaths: rootRequire('api/legacy/ds-routing/config/yesNoPathsConfigModel')(conn),
  };
  /* eslint-enable max-len*/

  const promises = [];
  Object.keys(models).forEach((modelName) => {
    const promise = getLegacyModelMap(modelName, models[modelName]);
    promises.push(promise);
  });

  app.locals.configs = {};

  return Promise.all(promises).then((modelMaps) => {
    modelMaps.forEach((modelMap) => {
      app.locals.configs[modelMap.name] = modelMap.data;
      logger.debug(`app.locals.configs loaded ${modelMap.count} ${modelMap.name}`);
    });
  });
};
