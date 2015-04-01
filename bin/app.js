#!/usr/bin/env node

var app = require('../lib/app');
var program = require('commander');

program.version('0.0.1')
  .option('-e, --environment [environment_name]', 'Creting environment name')
  .parse(process.argv);

var envName = program.environment;

app.create({envName: envName}, console.log, console.error);
