const allowedDomain = process.env.VAT_MARGIN_ALLOW_DOMAIN;
const debugBypassToken = process.env.VAT_MARGIN_DEBUG_BYPASS_TOKEN;

module.exports = function vatAuth(req, res, next) {
  if (!allowedDomain) {
    return res.status(500).json({ success: false, error: 'Auth not configured' });
  }

  if (debugBypassToken && req.headers['x-debug-bypass'] === debugBypassToken) {
    return next();
  }

  const userEmail = req.headers['x-user-email'];
  if (!userEmail || !userEmail.endsWith(`@${allowedDomain}`)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  return next();
};


