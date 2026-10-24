const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlayers } = require('../src/scout/input');

test('the order of the players does not matter', () => {
  assert.deepEqual(parsePlayers('Zed Main#EUW, alpha#EUW, Mid#EUNE'), parsePlayers('Mid#EUNE, Zed Main#EUW, alpha#EUW'));
  assert.deepEqual(parsePlayers('Zed Main#EUW, alpha#EUW, Mid#EUNE'), ['alpha#EUW', 'Mid#EUNE', 'Zed Main#EUW']);
});

test('players are split at commas, semicolons, new lines and plus signs', () => {
  assert.deepEqual(parsePlayers('Bob#EUW;Ann#EUW\nCarl#NA1 + Dora#EUW'), ['Ann#EUW', 'Bob#EUW', 'Carl#NA1', 'Dora#EUW']);
});

test('tagged names with spaces can follow each other without separators', () => {
  assert.deepEqual(parsePlayers('Hide on bush #KR1 Faker#KR1 Lone'), ['Faker#KR1', 'Hide on bush#KR1', 'Lone']);
});

test('names without tag and separators are split at spaces', () => {
  assert.deepEqual(parsePlayers('Bob Ann Carl'), ['Ann', 'Bob', 'Carl']);
  assert.deepEqual(parsePlayers('Hide on bush, Faker'), ['Faker', 'Hide on bush']);
});

test('pasted lobby chat and duplicates are cleaned up', () => {
  const chat = 'Bob#EUW joined the lobby\nAnn #EUW joined the lobby\nbob#euw left the lobby.';
  assert.deepEqual(parsePlayers(chat), ['Ann#EUW', 'Bob#EUW']);
});

test('empty input gives no players', () => {
  assert.deepEqual(parsePlayers(' , \n'), []);
  assert.deepEqual(parsePlayers(null), []);
});
