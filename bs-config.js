module.exports = {
  proxy: "localhost:3000",
  files: [
    "frontend/**/*.html",
    "frontend/**/*.js",
    "frontend/**/*.css"
  ],
  port: 3001,
  open: false,
  notify: false,
  reloadOnRestart: true,
  logLevel: "silent",
  ui: false
};
