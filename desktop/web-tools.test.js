const { test } = require('node:test');
const assert = require('node:assert/strict');

const { checkLink, createOpenTools, isSameSite } = require('./web-tools');

test('same site: the link host and its subdomains, ignoring a leading www.', () => {
  assert.ok(isSameSite('https://quizlet.com/', 'https://www.quizlet.com/en'));
  assert.ok(isSameSite('https://quizlet.com/', 'https://cdn.quizlet.com/x'));
  assert.ok(isSameSite('https://quizlet.com/', 'https://quizlet.com/latest'));
  assert.ok(isSameSite('https://www.quizlet.com/', 'https://quizlet.com/'));
  assert.ok(isSameSite('https://www.quizlet.com/', 'https://a.b.quizlet.com/'));
  assert.ok(isSameSite('https://translate.google.com/', 'https://translate.google.com/?sl=en'));
  assert.ok(isSameSite('https://translate.google.com/', 'https://x.translate.google.com/'));
});

test('same site: everything else is another site', () => {
  for (const target of ['https://www.google.com/', 'https://accounts.google.com/', 'https://sites.google.com/', 'https://google.com/']) {
    assert.equal(isSameSite('https://translate.google.com/', target), false, target);
  }
  assert.equal(isSameSite('https://a.github.io/', 'https://b.github.io/'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'https://quizlet.com.evil.example/'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'https://evilquizlet.com/'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'http://quizlet.com/'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'https://quizlet.com:8443/'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'https://youtube.com/'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'javascript:alert(1)'), false);
  assert.equal(isSameSite('https://quizlet.com/', 'not a url'), false);
  assert.equal(isSameSite('not a url', 'https://quizlet.com/'), false);
});

test('link rules accept public https pages and normalize them', () => {
  assert.equal(checkLink('https://quizlet.com'), 'https://quizlet.com/');
  assert.equal(checkLink(' https://Dictionary.Cambridge.org/x?y=1#z '), 'https://dictionary.cambridge.org/x?y=1#z');
  assert.equal(checkLink('https://quizlet.com:443/'), 'https://quizlet.com/');
  assert.equal(checkLink('https://rječnik.hr/'), 'https://xn--rjenik-k2a.hr/');
});

test('link rules refuse what the server refuses', () => {
  const refused = [
    'http://quizlet.com/',
    'ftp://quizlet.com/',
    'https://192.168.1.20/moodle',
    'https://[::1]/',
    'https://127.1/',
    'https://0177.0.0.1/',
    'https://0x7f.0.0.1/',
    'https://2130706433/',
    'https://%31%32%37.0.0.1/',
    'https://intranet.local/',
    'https://intranet.local./',
    'https://moodle/',
    'https://localhost/',
    'https://router.home.arpa/',
    'https://youtu.be/abc',
    'https://forms.gle/xyz',
    'https://www.bit.ly/x',
    'https://example.com/worksheet.pdf',
    'https://example.com/Setup.EXE',
    'https://example.com/a%2Ezip',
    'https://user:pw@quizlet.com/',
    'https://@quizlet.com/',
    'https://quizlet.com:8443/',
    'https://quizlet.com\\.evil.example/',
  ];
  for (const link of refused) assert.equal(checkLink(link), null, link);
});

test('malformed and script links are refused, never thrown', () => {
  for (const link of ['', '   ', 'not a url', 'https://', 'https://exa mple.com/', 'data:text/html,hi', 'javascript:alert(1)', 'about:blank']) {
    assert.equal(checkLink(link), null, link);
  }
  for (const value of [undefined, null, 42, {}, ['https://quizlet.com/']]) assert.equal(checkLink(value), null);
});

test('attach is allowed only for an open tool, compared after URL parsing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const tools = createOpenTools();
  tools.set(['https://quizlet.com', 'https://dictionary.cambridge.org/'], 60_000);
  assert.ok(tools.allows('https://quizlet.com/'));
  assert.ok(tools.allows('https://dictionary.cambridge.org/'));
  assert.equal(tools.allows('https://quizlet.com/latest'), false);
  assert.equal(tools.allows('https://www.quizlet.com/'), false);
  assert.equal(tools.allows('https://youtube.com/'), false);
  assert.equal(tools.allows('garbage'), false);
  assert.equal(tools.allows(undefined), false);
});

test('a list that breaks the link rules, or has no lesson end, opens nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const tools = createOpenTools();
  tools.set(['http://quizlet.com/', 'https://192.168.1.20/', 'https://quizlet.com/'], 60_000);
  assert.deepEqual(tools.list(), ['https://quizlet.com/']);
  tools.set(['https://quizlet.com/'], undefined);
  assert.deepEqual(tools.list(), []);
  tools.set(['https://quizlet.com/'], -5);
  assert.deepEqual(tools.list(), []);
  tools.set('https://quizlet.com/', 60_000);
  assert.deepEqual(tools.list(), []);
});

test('every tool closes when the lesson end passes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const changes = [];
  const tools = createOpenTools({ onChange: (list) => changes.push(list) });
  tools.set(['https://quizlet.com/'], 1000);
  assert.deepEqual(changes, [['https://quizlet.com/']]);
  t.mock.timers.tick(999);
  assert.ok(tools.allows('https://quizlet.com/'));
  t.mock.timers.tick(1);
  assert.deepEqual(tools.list(), []);
  assert.equal(tools.allows('https://quizlet.com/'), false);
  assert.deepEqual(changes.at(-1), []);
});

test('a newer list replaces the old one and its lesson end', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const tools = createOpenTools();
  tools.set(['https://quizlet.com/'], 1000);
  tools.set(['https://quizlet.com/', 'https://dictionary.cambridge.org/'], 5000);
  t.mock.timers.tick(1000);
  assert.equal(tools.list().length, 2);
  tools.set([], 5000);
  assert.deepEqual(tools.list(), []);
  tools.set(['https://quizlet.com/'], 5000);
  tools.clear();
  assert.deepEqual(tools.list(), []);
});

test('the same list again reports no change but still moves the lesson end', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const changes = [];
  const tools = createOpenTools({ onChange: (list) => changes.push(list) });
  tools.set(['https://quizlet.com/'], 1000);
  t.mock.timers.tick(500);
  tools.set(['https://quizlet.com'], 1000);
  assert.equal(changes.length, 1);
  t.mock.timers.tick(900);
  assert.ok(tools.allows('https://quizlet.com/'));
  t.mock.timers.tick(100);
  assert.deepEqual(changes, [['https://quizlet.com/'], []]);
});
