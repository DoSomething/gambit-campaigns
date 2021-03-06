'use strict';

/* eslint-disable global-require */

// @see https://docs.newrelic.com/docs/agents/nodejs-agent/installation-configuration
require('newrelic');

// configuration
const config = require('./config');

// 3rd party modules
// logger has to be required after config
const logger = require('winston');
const throng = require('throng');

function start(processId) {
  logger.info(`Started worker ${processId}`);

  // app modules
  const app = require('./app');

  // Setup Gateway client.
  require('./lib/gateway').getClient();

  /**
   * Profiler setup
   * TODO: Move out to external file
   */
  const Profiler = require('./lib/tools/profiler');
  const Uploader = require('./lib/tools/uploader');

  if (process.env.V8_PROFILER_ENABLED &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY) {
    logger.info('HEAP SNAPSHOT PROFILER IS ENABLED.');

    const profiler = new Profiler({
      interval: process.env.V8_PROFILER_DEFAULT_INTERVAL_MS || 3600000,
      tag: `worker #${processId}`,
      extension: 'heapsnapshot',
      namePrefix: process.env.V8_PROFILER_NAME_PREFIX || 'v8.heap.snapshot',
    });
    const uploader = new Uploader({
      params: {
        Bucket: process.env.V8_PROFILER_S3_BUCKET || 'local-v8-profiler.dosomething.org',
        ContentType: 'binary/octet-stream',
        ACL: 'public-read',
      },
    });

    /**
     * The profiler has fired the snapshotCreated event, now we can process the snapshot
     */
    profiler.on('snapshotCreated', (snapshot) => {
      const fileName = snapshot.getHeader().title;
      const uploadStream = uploader.getUploadStream(fileName);

      /**
       * This is the multipart stream that will upload the snapshot to S3
       */
      uploadStream
        .on('error', (error) => {
          logger.info(`Upload Stream error: ${error}`);
          snapshot.delete();
        })
        .on('uploaded', (details) => {
          logger.debug(`Snapshot upload successful. File name: ${details.Key}`);
          snapshot.delete();
        });

      /**
       * This is the snapshot stream that will pipe the serialized version of the
       * snapshot to the uploadStream
       */
      snapshot
        .export()
        .pipe(uploadStream)
        .on('error', error => logger.info(`Snapshot error: ${error}`));
    });
    profiler.start();
  }

  // set app properties
  app.set('currentProcess', processId);
  app.set('apiKey', config.apiKey);
  app.set('environment', config.environment);

  // Expose which worker is handling request through middleware
  // TODO: Move to external middleware
  app.use((req, res, next) => {
    logger.info(`Request handled by worker ${app.get('currentProcess')}`);
    next();
  });

  return app.listen(config.port, () => {
    logger.info(`Gambit is listening on port:${config.port} env:${config.environment}.`);
  });
}

// Initialize Concurrency
throng({
  workers: config.webConcurrency,
  lifetime: Infinity,
  start,
});
