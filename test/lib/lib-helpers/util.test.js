'use strict';

// env variables
require('dotenv').config();

// Libraries
const test = require('ava');
const chai = require('chai');
const logger = require('winston');
const sinonChai = require('sinon-chai');
const sinon = require('sinon');

// App Modules
const stubs = require('../../utils/stubs');

// Config
const config = require('../../../config/lib/helpers/util');

// Module to test
const utilHelper = require('../../../lib/helpers/util');

// setup "x.should.y" assertion style
chai.should();
chai.use(sinonChai);

const sandbox = sinon.sandbox.create();

// Setup!
test.beforeEach(() => {
  stubs.stubLogger(sandbox, logger);
});

// Cleanup!
test.afterEach(() => {
  // reset stubs, spies, and mocks
  sandbox.restore();
});

/**
 * Tests
 */

// getDefaultMetaLimit
test('getDefaultIndexQueryLimit returns config.defaultIndexQueryLimit', () => {
  const result = utilHelper.getDefaultIndexQueryLimit();
  result.should.equal(config.defaultIndexQueryLimit);
});

// getMeta
test('getMeta returns an object with pagination properties with given args', () => {
  const total = 200;
  const skip = 10;
  const limit = 30;
  const result = utilHelper.getMeta(total, skip, limit);
  result.pagination.total.should.equal(total);
  result.pagination.skip.should.equal(skip);
  result.pagination.limit.should.equal(limit);
});

test('getMeta returns an object with default pagination properties if args are empty', () => {
  const result = utilHelper.getMeta();
  result.pagination.total.should.equal(0);
  result.pagination.skip.should.equal(0);
  result.pagination.limit.should.equal(utilHelper.getDefaultIndexQueryLimit());
});

// isValidQuantity
test('isValidQuantity() validations', () => {
  // non decimal number should pass
  utilHelper.isValidQuantity('1').should.be.true;
  utilHelper.isValidQuantity(' 1').should.be.true;
  utilHelper.isValidQuantity(' 1 ').should.be.true;
  // decimal number should not pass
  utilHelper.isValidQuantity('1.1').should.be.false;
  utilHelper.isValidQuantity(' 1.1').should.be.false;
  utilHelper.isValidQuantity(' 1.1 ').should.be.false;
  utilHelper.isValidQuantity(' 0.9 ').should.be.false;
  // any text should not pass
  utilHelper.isValidQuantity('a').should.be.false;
  utilHelper.isValidQuantity(' 1a').should.be.false;
  utilHelper.isValidQuantity('1,').should.be.false;
  utilHelper.isValidQuantity('1 hundred').should.be.false;
});

// isValidText
test('isValidText() validations', () => {
  // Text can't be empty
  utilHelper.isValidText('').should.be.false;
  utilHelper.isValidText('       ').should.be.false;
  // Text must meet length requirements
  utilHelper.isValidText(stubs.getRandomString(config.minTextLength + 1)).should.be.true;
  utilHelper.isValidText(stubs.getRandomString(config.minTextLength)).should.be.false;
});

// trimText
test('trimText() validations', () => {
  // It should trim spaces out of text
  const text1 = stubs.getRandomString();
  utilHelper.trimText(`   ${text1}   `).should.be.equal(text1);
  // If longer that maxTextLength it should ellipsify
  const text2 = stubs.getRandomString(config.maxTextLength + 10);
  const result2 = utilHelper.trimText(text2);
  result2.indexOf(config.ellipsis).should.be.equal(result2.length - config.ellipsis.length);
  // Text shouldn't be longer than 255|maxTextLength
  const text3 = stubs.getRandomString(config.maxTextLength + 100);
  const result3 = utilHelper.trimText(text3);
  result3.length.should.be.equal(config.maxTextLength);
});
