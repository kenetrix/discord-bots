const fs = require('node:fs');

/** Lädt alle Command-Module aus diesem Ordner. */
module.exports = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.js') && file !== 'index.js')
  .map((file) => require(`./${file}`));
