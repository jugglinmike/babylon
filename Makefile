MAKEFLAGS = -j1
TEST262_COMMIT = 4ea2931f169d4a4b5a9a4a7c731cc92bf7b3e13c

export NODE_ENV = test

# Fix color output until TravisCI fixes https://github.com/travis-ci/travis-ci/issues/7967
export FORCE_COLOR = true

.PHONY: make clean test test-only test-cov test-clean test-travis publish build bootstrap publish-core publish-runtime build-website build-core watch-core build-core-test clean-core prepublish

clean: ; rm -rf ./build

bootstrap-babel: clean
	mkdir ./build
	git clone --depth=1 --branch=7.0 https://github.com/babel/babel.git ./build/babel
	cd ./build/babel; \
	make bootstrap
	find ./build/babel/packages -type d -name 'babylon' -prune -exec rm -rf '{}' \; -exec ln -s '../../../../../' '{}' \;

test-babel:
	BABEL_ENV=test yarn run build
	# in case babel ever switches to nyc: filter its config out of package.json
	cd ./build/babel; \
	jq "del(.nyc)" package.json > package.nonyc.json; \
	mv -f package.nonyc.json package.json; \
	../../node_modules/.bin/nyc --no-instrument --no-source-map --reporter=json --report-dir ../../coverage node_modules/mocha/bin/_mocha `scripts/_get-test-directories.sh` --opts test/mocha.opts --compilers js:babel-register; \

bootstrap-flow: clean
	mkdir ./build
	git clone --depth=1 --branch=master https://github.com/facebook/flow.git ./build/flow

test-flow:
	node scripts/run_flow_tests.js

bootstrap-test262: clean
	mkdir ./build
	git clone https://github.com/tc39/test262.git ./build/test262
	cd build/test262 && git checkout $(TEST262_COMMIT)

test-test262:
	node scripts/run_test262.js
