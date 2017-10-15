"use strict";

const path = require("path");
const chalk = require("chalk");
const utils = require("./run_test262_utils");

const testDir = path.join(__dirname, "..", "build", "test262");
const whitelistFile = path.join(__dirname, "test262_whitelist.txt");
const plugins = ["asyncGenerators", "objectRestSpread", "optionalCatchBinding"];
const shouldUpdate = process.argv.indexOf("--update-whitelist") > -1;

const streamTests = require('../../test262-harness').streamTests;

utils.getWhitelist(whitelistFile)
  .then(function(whitelist) {
    console.log(`Now running tests...`);

    const stream = streamTests(testDir);
    const results = [];

    stream.on('data', function(testObject) {
      testObject.file = path.relative('test', testObject.file);
      results.push(utils.runTest(testObject, plugins));
    });

    return new Promise(function(resolve, reject) {
       stream.on('error', reject);
       stream.on('end', function() {
         resolve(utils.interpret(results, whitelist));
       });
    });
  })
  .then(function(summary) {
    const goodnews = [
      summary.allowed.success.length + " valid programs parsed without error",
      summary.allowed.failure.length +
        " invalid programs produced a parsing error",
      summary.allowed.falsePositive.length +
        " invalid programs did not produce a parsing error" +
        " (and allowed by the whitelist file)",
      summary.allowed.falseNegative.length +
        " valid programs produced a parsing error" +
        " (and allowed by the whitelist file)",
    ];
    const badnews = [];
    const badnewsDetails = [];

    void [
      {
        tests: summary.disallowed.success,
        label:
          "valid programs parsed without error" +
          " (in violation of the whitelist file)",
      },
      {
        tests: summary.disallowed.failure,
        label:
          "invalid programs produced a parsing error" +
          " (in violation of the whitelist file)",
      },
      {
        tests: summary.disallowed.falsePositive,
        label:
          "invalid programs did not produce a parsing error" +
          " (without a corresponding entry in the whitelist file)",
      },
      {
        tests: summary.disallowed.falseNegative,
        label:
          "valid programs produced a parsing error" +
          " (without a corresponding entry in the whitelist file)",
      },
      {
        tests: summary.unrecognized,
        label: "non-existent programs specified in the whitelist file",
      },
    ].forEach(function({ tests, label }) {
      if (!tests.length) {
        return;
      }

      const desc = tests.length + " " + label;

      badnews.push(desc);
      badnewsDetails.push(desc + ":");
      badnewsDetails.push(
        ...tests.map(function(test) {
          return test.id || test;
        })
      );
    });

    console.log("Testing complete.");
    console.log("Summary:");
    console.log(chalk.green(goodnews.join("\n").replace(/^/gm, " ✔ ")));

    if (!summary.passed) {
      console.log("");
      console.log(chalk.red(badnews.join("\n").replace(/^/gm, " ✘ ")));
      console.log("");
      console.log("Details:");
      console.log(badnewsDetails.join("\n").replace(/^/gm, "   "));
    }

    if (shouldUpdate) {
      return utils.updateWhitelist(whitelistFile, summary).then(function() {
        console.log("");
        console.log("Whitelist file updated.");
      });
    } else {
      process.exitCode = summary.passed ? 0 : 1;
    }
  })
  .catch(function(err) {
    console.error(err);
    process.exitCode = 1;
  });
