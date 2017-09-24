"use strict";

const fs = require("graceful-fs");
const path = require("path");
const promisify = require("util.promisify");
const pfs = {
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  readdir: promisify(fs.readdir),
  stat: promisify(fs.stat)
};

const parse = require("..").parse;

const modulePattern = /^\s*-\s*module\s*$|^\s*flags\s*:.*\bmodule\b/m;
const noStrictPattern = /^\s*-\s*noStrict\s*$|^\s*flags\s*:.*\bnoStrict\b/m;
const onlyStrictPattern = /^\s*-\s*onlyStrict\s*$|^\s*flags\s*:.*\bonlyStrict\b/m;
const rawPattern = /^\s*-\s*raw\s*$|^\s*flags\s*:.*\braw\b/m;
const testNamePattern = /^(?!.*_FIXTURE).*\.[jJ][sS]$/;

function readTest(fileName, testDir) {
  if (!testNamePattern.test(fileName)) {
    return Promise.resolve([]);
  }

  return pfs.readFile(fileName, "utf-8").then(function(contents) {
    return makeScenarios(path.relative(testDir, fileName), contents);
  });
}

function makeScenarios(fileName, testContent) {
  const scenarios = [];
  const base = {
    fileName: fileName,
    isModule: modulePattern.test(testContent),
    expectedError: hasEarlyError(testContent),
  };
  const isNoStrict = noStrictPattern.test(testContent);
  const isOnlyStrict = onlyStrictPattern.test(testContent);
  const isRaw = rawPattern.test(testContent);

  if (!isOnlyStrict) {
    scenarios.push(
      Object.assign(
        {
          id: fileName + "(default)",
          content: testContent,
        },
        base
      )
    );
  }

  if (!isNoStrict && !isRaw) {
    scenarios.push(
      Object.assign(
        {
          id: fileName + "(strict mode)",
          content: "'use strict';\n" + testContent,
        },
        base
      )
    );
  }

  return scenarios;
}

exports.runTest = function(test, plugins) {
  const result = {
    fileName: test.file,
	id: test.file + "(" + test.scenario + ")",
	content: test.contents,
	expectedError: test.attrs.negative && test.attrs.negative.phase === "early"
  };
  const sourceType = test.attrs.flags.module ? "module" : "script";

  try {
    parse(test.contents, { sourceType: sourceType, plugins: plugins });
    result.actualError = false;
  } catch (err) {
    result.actualError = true;
  }

  return result;
};

exports.getWhitelist = function(filename) {
  return pfs.readFile(filename, "utf-8").then(function(contents) {
    return contents
      .split("\n")
      .map(function(line) {
        return line.replace(/#.*$/, "").trim();
      })
      .filter(function(line) {
        return line.length > 0;
      })
      .reduce(function(table, filename) {
        table[filename] = true;
        return table;
      }, Object.create(null));
  });
};

exports.updateWhitelist = function(filename, summary) {
  return pfs.readFile(filename, "utf-8").then(function(contents) {
    const toRemove = summary.disallowed.success
      .concat(summary.disallowed.failure)
      .map(function(test) {
        return test.id;
      });
    const toAdd = summary.disallowed.falsePositive
      .concat(summary.disallowed.falseNegative)
      .map(function(test) {
        return test.id;
      });
    const newContents = contents
      .split("\n")
      .map(function(line) {
        const testId = line.replace(/#.*$/, "").trim();

        if (toRemove.indexOf(testId) > -1) {
          return null;
        }

        return line;
      })
      .filter(function(line) {
        return line !== null;
      })
      .concat(toAdd)
      .join("\n");

    return pfs.writeFile(filename, newContents, "utf-8");
  });
};

exports.interpret = function(results, whitelist) {
  const summary = {
    passed: true,
    allowed: {
      success: [],
      failure: [],
      falsePositive: [],
      falseNegative: [],
    },
    disallowed: {
      success: [],
      failure: [],
      falsePositive: [],
      falseNegative: [],
    },
    unrecognized: null,
  };

  results.forEach(function(result) {
    let classification, isAllowed;
    const inWhitelist = result.id in whitelist;
    delete whitelist[result.id];

    if (!result.expectedError) {
      if (!result.actualError) {
        classification = "success";
        isAllowed = !inWhitelist;
      } else {
        classification = "falseNegative";
        isAllowed = inWhitelist;
      }
    } else {
      if (!result.actualError) {
        classification = "falsePositive";
        isAllowed = inWhitelist;
      } else {
        classification = "failure";
        isAllowed = !inWhitelist;
      }
    }

    summary.passed &= isAllowed;
    summary[isAllowed ? "allowed" : "disallowed"][classification].push(result);
  });

  summary.unrecognized = Object.keys(whitelist);
  summary.passed = !!summary.passed && summary.unrecognized.length === 0;

  return summary;
};
