const msg =
  "[@tanso/observe] This package name is a placeholder reserved to prevent " +
  "typosquatting. The real package is @tansohq/observe. " +
  "Install it with: npm install @tansohq/observe";

console.error(msg);
throw new Error(msg);
