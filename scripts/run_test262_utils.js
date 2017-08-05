"use strict";

const fs = require("fs");
const path = require("path");

const parse = require("..").parse;

const modulePattern = /^\s*-\s*module\s*$|^\s*flags\s*:.*\bmodule\b/m;
const noStrictPattern = /^\s*-\s*noStrict\s*$|^\s*flags\s*:.*\bnoStrict\b/m;
const onlyStrictPattern = /^\s*-\s*onlyStrict\s*$|^\s*flags\s*:.*\bonlyStrict\b/m;
const rawPattern = /^\s*-\s*raw\s*$|^\s*flags\s*:.*\braw\b/m;
const testNamePattern = /^(?!.*_FIXTURE).*\.[jJ][sS]$/;

function flatten(array) {
  const flattened = [];
  array.forEach(function(element) {
    if (Array.isArray(element)) {
      flattened.push.apply(flattened, element);
    } else {
      flattened.push(element);
    }
  });
  return flattened;
}

function hasEarlyError(src) {
  return !!(
    src.match(/^\s*negative:\s*$/m) && src.match(/^\s+phase:\s*early\s*$/m)
  );
}

function readDir(dirName) {
  return new Promise(function(resolve, reject) {
    fs.readdir(dirName, function(err, contents) {
      if (err) {
        reject(err);
        return;
      }

      Promise.all(
        contents.map(function(name) {
          return findTests(path.join(dirName, name));
        })
      )
        .then(flatten)
        .then(resolve, reject);
    });
  });
}

function findTests(name) {
  return new Promise(function(resolve, reject) {
    fs.stat(name, function(err, stat) {
      if (err) {
        reject(err);
        return;
      }

      if (stat.isDirectory()) {
        readDir(name).then(resolve, reject);
        return;
      }

      resolve(name);
    });
  });
}

function readFile(fileName) {
  return new Promise(function(resolve, reject) {
    fs.readFile(fileName, { encoding: "utf-8" }, function(err, contents) {
      if (err) {
        reject(err);
        return;
      }

      resolve(contents);
    });
  });
}

function writeFile(fileName, contents) {
  return new Promise(function(resolve, reject) {
    fs.writeFile(fileName, contents, { encoding: "utf-8" }, function(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function readTest(fileName, testDir) {
  if (!testNamePattern.test(fileName)) {
    return Promise.resolve([]);
  }

  return readFile(fileName).then(function(contents) {
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

exports.getTests = function(testDir) {
  return findTests(testDir)
    .then(function(testPaths) {
      return Promise.all(
        testPaths.map(function(path) {
          return readTest(path, testDir);
        })
      );
    })
    .then(flatten);
};

exports.runTest = function(test, plugins) {
  const sourceType = test.isModule ? "module" : "script";

  try {
    parse(test.content, { sourceType: sourceType, plugins: plugins });
    test.actualError = false;
  } catch (err) {
    test.actualError = true;
  }

  test.result = test.expectedError !== test.actualError ? "fail" : "pass";

  return test;
};

exports.getWhitelist = function(filename) {
  return readFile(filename).then(function(contents) {
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
  return readFile(filename).then(function(contents) {
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

    return writeFile(filename, newContents);
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
