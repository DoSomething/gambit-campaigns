require('newrelic'); // eslint-disable-line strict
// @see https://docs.newrelic.com/docs/agents/nodejs-agent/installation-configuration
// New Relic is required on first line, otherwise would declare 'use strict' for line 1 per eslint

// Wrapper around require to set relative path at app root
global.rootRequire = function (name) {
  return require(`${__dirname}/${name}`);
};

const express = require('express');
const http = require('http');

// Default is 5. Increasing # of concurrent sockets per host.
http.globalAgent.maxSockets = 100;

app = express();

const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// TODO: I don't think we need this?
app.use(require('connect-multiparty')());
// Also unsure if this is used:
const errorHandler = require('errorhandler');
app.use(errorHandler());

const DB_URI = process.env.DB_URI || 'mongodb://localhost/ds-mdata-responder';

/**
 * Load logger.
 */
const winston = require('winston');
require('winston-mongodb').MongoDB; // eslint-disable-line no-unused-expressions
const WINSTON_LEVEL = process.env.LOGGING_LEVEL || 'info';

app.locals.logger = new (winston.Logger)({
  levels: {
    verbose: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  },
  transports: [
    new winston.transports.Console({ prettyPrint: true, colorize: true, level: WINSTON_LEVEL }),
    new winston.transports.MongoDB({ dbUri: DB_URI, level: WINSTON_LEVEL }),
  ],
  exceptionHandlers: [
    new winston.transports.Console({ prettyPrint: true, colorize: true }),
    new winston.transports.MongoDB({ dbUri: DB_URI }),
  ],
});
if (!app.locals.logger) {
  process.exit(1);
}

const loader = require('./config/locals');

require('./config/router');

/**
 * Load models.
 */
const mongoose = require('mongoose');
mongoose.Promise = global.Promise;

const conn = mongoose.createConnection(DB_URI);
app.locals.db = loader.getModels(conn);

const logger = app.locals.logger;

/**
 * Load clients.
 */
app.locals.clients = {};

const NorthstarClient = require('@dosomething/northstar-js');
app.locals.clients.northstar = new NorthstarClient({
  baseURI: process.env.DS_NORTHSTAR_API_BASEURI,
  apiKey: process.env.DS_NORTHSTAR_API_KEY,
});

if (!app.locals.clients.northstar) {
  logger.error('app.locals.clients.northstar undefined');
  process.exit(1);
}

const PhoenixClient = require('@dosomething/phoenix-js');
app.locals.clients.phoenix = new PhoenixClient({
  baseURI: process.env.DS_PHOENIX_API_BASEURI,
  username: process.env.DS_PHOENIX_API_USERNAME,
  password: process.env.DS_PHOENIX_API_PASSWORD,
});

if (!app.locals.clients.phoenix) {
  logger.error('app.locals.clients.phoenix undefined');
  process.exit(1);
}


conn.on('connected', () => {
  logger.info(`conn.readyState:${conn.readyState}`);

  /**
   * Load campaigns.
   */
  app.locals.campaigns = {};
  app.locals.keywords = {};

  const campaigns = app.locals.clients.phoenix.Campaigns
    .index({ ids: process.env.CAMPAIGNBOT_CAMPAIGNS || '2070,2299' })
    .then((phoenixCampaigns) => {
      logger.debug(`app.locals.clients.phoenix found ${phoenixCampaigns.length} campaigns`);

      return phoenixCampaigns.map(phoenixCampaign => loader.loadCampaign(phoenixCampaign));
    });

  /**
   * Load controllers.
   */
  app.locals.controllers = {};

  const campaignBot = loader.loadBot('campaignbots', process.env.CAMPAIGNBOT_ID || 41)
    .then((bot) => {
      const CampaignBotController = rootRequire('api/controllers/CampaignBotController');
      app.locals.controllers.campaignBot = new CampaignBotController(bot);
      logger.info('loaded app.locals.controllers.campaignBot');

      return app.locals.controllers.campaignBot;
    });

  const donorsChooseBot = loader.loadBot('donorschoosebots', process.env.DONORSCHOOSEBOT_ID || 31)
    .then((bot) => {
      const DonorsChooseBotController = rootRequire('api/controllers/DonorsChooseBotController');
      app.locals.controllers.donorsChooseBot = new DonorsChooseBotController(bot);
      logger.info('loaded app.locals.controllers.donorsChooseBot');

      return app.locals.controllers.donorsChooseBot;
    });

  /**
   * Load legacy configs.
   */
  app.locals.configs = {};
  const uriConfig = process.env.CONFIG_DB_URI || 'mongodb://localhost/config';
  const connConfig = mongoose.createConnection(uriConfig);
  const legacyConfigs = loader.loadLegacyConfigs(connConfig);

  const legacyPhoenix = rootRequire('lib/phoenix')();
  const username = process.env.DS_PHOENIX_API_USERNAME;
  const password = process.env.DS_PHOENIX_API_PASSWORD;
  const legacyAuth = legacyPhoenix.userLogin(username, password, (err, response) => {
    if (err) {
      logger.error(err);
    }
    if (response && response.statusCode === 200) {
      logger.info('Successfully logged in to %s Phoenix API.', process.env.NODE_ENV);
    }
  });

  /**
   * Start server.
   */
  Promise.all([campaigns, campaignBot, donorsChooseBot, legacyConfigs, legacyAuth]).then(() => {
    const port = process.env.PORT || 5000;

    return app.listen(port, () => {
      logger.info(`Gambit is listening on port:${port} env:${process.env.NODE_ENV}.`);
    });
  })
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
});
