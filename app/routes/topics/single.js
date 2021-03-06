'use strict';

const express = require('express');

const getTopicMiddleware = require('../../../lib/middleware/topics/single/topic-get');

const router = express.Router({ mergeParams: true });

router.use(getTopicMiddleware());

module.exports = router;
