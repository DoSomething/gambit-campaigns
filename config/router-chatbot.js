'use strict';

/**
 * Imports.
 */
const express = require('express');
const router = express.Router(); // eslint-disable-line new-cap
const logger = rootRequire('lib/logger');
const mobilecommons = rootRequire('lib/mobilecommons');

/**
 * Handle chatbot conversations.
 */
router.post('/', (req, res) => {
  /* eslint-disable no-param-reassign */
  req.incoming_message = req.body.args;
  req.incoming_image_url = req.body.mms_image_url;
  req.mobilecommons_profile_update = {};
  /* eslint-enable no-param-reassign */

  logger.debug(`msg:${req.incoming_message} img:${req.incoming_image_url}`);

  const botType = req.query.bot_type;

  if (botType === 'slothbot') {
    // TODO: Store as a config variable.
    const slothbotOptinPath = 210045;
    const msgTxt = app.locals.controllers.slothBot.renderResponseMessage(req);
    mobilecommons.chatbot(req.body, slothbotOptinPath, msgTxt);

    return res.send({ message: msgTxt });
  }

  if (botType === 'donorschoose' || botType === 'donorschoosebot') {
    return app.locals.controllers.donorsChooseBot.chatbot(req, res);
  }

  let configured = true;
  // Check for required config variables.
  const settings = [
    'GAMBIT_CMD_MEMBER_SUPPORT',
    'GAMBIT_CMD_REPORTBACK',
    'MOBILECOMMONS_OIP_AGENTVIEW',
    'MOBILECOMMONS_OIP_CHATBOT',
  ];
  settings.forEach((configVar) => {
    if (!process.env[configVar]) {
      logger.error(`undefined process.env.${configVar}`);
      configured = false;
    }
  });

  if (!configured) {
    return res.sendStatus(500);
  }

  let campaign;
  let campaignId;
  if (req.body.keyword) {
    req.keyword = req.body.keyword.toLowerCase(); // eslint-disable-line no-param-reassign
    logger.debug(`keyword:${req.keyword}`);

    campaignId = app.locals.keywords[req.keyword];
    campaign = app.locals.campaigns[campaignId];
    if (!campaign) {
      logger.error(`app.locals.campaigns[${campaignId}] undefined`);

      return res.sendStatus(500);
    }
  }

  const controller = app.locals.controllers.campaignBot;
  if (!controller) {
    logger.error('app.locals.controllers.campaignBot undefined');

    return res.sendStatus(500);
  }

  return controller
    .loadUser(req)
    .then(user => {
      controller.debug(req, `loaded user:${user._id}`);

      /* eslint-disable no-param-reassign */
      req.user = user;
      if (!req.body.profile_northstar_id) {
        req.mobilecommons_profile_update.northstar_id = user.id;
      }
      /* eslint-enable no-param-reassign */

      if (!campaign) {
        campaignId = user.current_campaign;
        controller.debug(req, `set campaignId:${campaignId}`);

        if (!campaignId) {
          // TODO: Send to non-existent start menu to select a campaign.
          logger.error(`user:${req.user_id} current_campaign undefined`);
        }

        campaign = app.locals.campaigns[campaignId];

        // TODO: Edge-case where the user's saved campaign has been closed since signup created

        if (!campaign) {
          // TODO: Same - send to start menu to select campaign if not found for campaignId.
          logger.error(`app.locals.campaigns[${campaignId}] undefined`);
        }
      }
      req.campaign_id = campaignId; // eslint-disable-line no-param-reassign
      req.campaign = campaign; // eslint-disable-line no-param-reassign

      if (controller.isCommand(req, 'clear_cache')) {
        req.user.campaigns = {}; // eslint-disable-line no-param-reassign
        logger.info(`${controller.loggerPrefix(req)} cleared user.campaigns`);

        return controller.getCurrentSignup(req);
      }

      const signupId = user.campaigns[req.campaign_id];

      if (signupId) {
        return controller.loadCurrentSignup(req, signupId);
      }

      return controller.getCurrentSignup(req);
    })
    .then(signup => {
      controller.debug(req, `loaded signup:${signup._id.toString()}`);
      req.signup = signup; // eslint-disable-line no-param-reassign

      if (!signup) {
        // TODO: Handle this edge-case.
        logger.error('signup undefined');
      }

      if (controller.isCommand(req, 'member_support')) {
        return controller.renderResponseMessage(req, 'member_support');
      }

      if (campaign.status === 'closed') {
        controller.debug(req, 'campaign closed');

        return controller.renderResponseMessage(req, 'campaign_closed');
      }

      if (signup.draft_reportback_submission) {
        return controller.continueReportbackSubmission(req);
      }

      if (controller.isCommand(req, 'reportback')) {
        return controller.createReportbackSubmission(req);
      }

      if (signup.total_quantity_submitted) {
        if (req.keyword) {
          return controller.renderResponseMessage(req, 'menu_completed');
        }
        // If we're this far, member didn't text back Reportback or Member Support commands.
        return controller.renderResponseMessage(req, 'invalid_cmd_completed');
      }

      if (req.keyword) {
        return controller.renderResponseMessage(req, 'menu_signedup');
      }

      return controller.renderResponseMessage(req, 'invalid_cmd_signedup');
    })
    .then(msg => {
      const gambitResponse = { message: msg };
      controller.debug(req, `sendMessage:${msg}`);
      controller.setCurrentCampaign(req.user, req.campaign_id);

      if (process.env.MOBILECOMMONS_DISABLED) {
        logger.warn('MOBILECOMMONS_DISABLED');

        return res.send(gambitResponse);
      }

      let responseOIP = process.env.MOBILECOMMONS_OIP_CHATBOT;
      if (controller.isCommand(req, 'member_support')) {
        responseOIP = process.env.MOBILECOMMONS_OIP_AGENTVIEW;
      }

      // The responseOIP Conversation is set to display gambit_chatbot_response value via Liquid.
      // @see https://github.com/DoSomething/gambit/wiki/Chatbot#mobile-commons
      /* eslint-disable no-param-reassign */
      req.mobilecommons_profile_update.gambit_chatbot_response = msg;
      /* eslint-enable no-param-reassign */
      mobilecommons.profile_update(req.body.phone, responseOIP, req.mobilecommons_profile_update);

      return res.send(gambitResponse);
    })
    .catch(err => {
      controller.error(req, res, err);

      return res.sendStatus(500);
    });
});

module.exports = router;
