'use strict';

const underscore = require('underscore');
const configExists = require('file-exists');

// Load environment dependent config variables
const localEnv = process.env.NODE_ENV || 'development';
const environment = localEnv.toLowerCase();
const envConfigPath = `${__dirname}/env/${environment}.js`;
let envConfig = {};

if (configExists.sync(envConfigPath)) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  envConfig = require(envConfigPath);
}

// Default config variables
const defaultConfig = {
  environment,
  port: process.env.PORT || 5000,
  webConcurrency: process.env.WEB_CONCURRENCY || 1,
  apiKey: process.env.GAMBIT_API_KEY || 'totallysecret',
  // overridden in production to true
  forceHttps: false,
};

const configVars = underscore.extend({}, defaultConfig, envConfig);

/**
 * Winston Logger setup
 * We don't need to export the Logger. Just require adhoc in whatever file we need it,
 * like: const logger = require('winston');
 */
require('./logger')({});

module.exports = configVars;
