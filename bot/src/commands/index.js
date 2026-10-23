const fs = require('node:fs');

/** Loads all command modules in this folder. */
module.exports = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.js') && file !== 'index.js')
  .map((file) => require(`./${file}`));
