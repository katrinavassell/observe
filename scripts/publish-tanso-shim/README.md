# @tanso/observe defensive shim

Placeholder package that reserves the `@tanso/observe` name on npm so a bad
actor cannot squat it. LLMs have been seen hallucinating this name instead of
the real `@tansohq/observe`.

## Publish

```sh
cd scripts/publish-tanso-shim
npm publish --access public
```

Requires ownership of the `@tanso` scope on npmjs.com. If the scope does not
exist, create it first (free) at https://www.npmjs.com/org/create.

## Verify

```sh
mkdir /tmp/squat-check && cd /tmp/squat-check && npm init -y
npm install @tanso/observe
node -e "require('@tanso/observe')"
# → should print the deprecation message and exit with code 1
```
