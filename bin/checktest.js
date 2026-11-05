#!/usr/bin/env node
const { main } = require('../dist/src/cli.js');
process.exitCode = main(process.argv.slice(2));
