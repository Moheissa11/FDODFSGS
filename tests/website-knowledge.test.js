const test = require('node:test');
const assert = require('node:assert/strict');
const { getWebsiteHelpReply, getWebsiteNavigationIntent, WEBSITE_KNOWLEDGE } = require('../website-knowledge');

test('returns stored Arabic directions for Solar System controls', () => {
  const reply = getWebsiteHelpReply('ازاي استخدم السولار سيستم؟');
  assert.match(reply, /Solar System Scan/);
  assert.match(reply, /عجلة الماوس/);
});

test('returns stored English directions for Compare', () => {
  const reply = getWebsiteHelpReply('How do I use the compare page?');
  assert.match(reply, /Earth vs Mars/);
  assert.match(reply, /Search & Explore/);
});

test('returns stored library guidance and does not answer unrelated messages', () => {
  assert.match(getWebsiteHelpReply('فين مكتبتي؟'), /My Library/);
  assert.equal(getWebsiteHelpReply('Tell me a joke'), null);
});

test('assistant knowledge base documents the actual website sections', () => {
  assert.match(WEBSITE_KNOWLEDGE, /Mission Lab/);
  assert.match(WEBSITE_KNOWLEDGE, /Solar System/);
  assert.match(WEBSITE_KNOWLEDGE, /My Library/);
});

test('Cero returns direct navigation for natural Solar System requests', () => {
  assert.deepEqual(getWebsiteNavigationIntent('عايز اشوف المجموعة الشمسية'), {route:'/solar/',page:'solar',planet:null});
  assert.equal(getWebsiteNavigationIntent('عايز اشوف الكواكب').page, 'solar');
  assert.equal(getWebsiteNavigationIntent('عايز اشوف الكواكب').page, 'solar');
  assert.deepEqual(getWebsiteNavigationIntent('Show me Mars'), {route:'/solar/?planet=mars',page:'solar',planet:'mars'});
  assert.equal(getWebsiteNavigationIntent('What is Mars?'), null, 'scientific questions should be answered, not hijacked by navigation');
  assert.match(getWebsiteHelpReply('عايز اشوف المجموعة الشمسية'), /Solar System Scan/);
});

test('Cero routes questions to existing site sections', () => {
  assert.equal(getWebsiteNavigationIntent('ساعدني في Scientific Maps').route, '/#terratwin');
  assert.equal(getWebsiteNavigationIntent('Where is Mission Lab?').route, '/#mission');
  assert.equal(getWebsiteNavigationIntent('عايز صور ناسا').route, '/#research');
});
