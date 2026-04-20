// PM2 Ecosystem Configuration for SNAP Bridge
// Usage:
//   pm2 start ecosystem.config.js          # Start the app
//   pm2 restart ecosystem.config.js        # Restart with config reload
//   pm2 stop snap-bridge                   # Stop
//   pm2 logs snap-bridge                   # View logs
//   pm2 monit                              # Real-time monitoring

module.exports = {
  apps: [
    {
      name: 'snap-bridge',
      script: 'dist/index.js',
      interpreter: 'node',

      // Working directory — adjust to your deployment path on the server
      cwd: '/var/www/snap-bridge',

      // Load environment variables from .env file
      // WARNING: Use a .env file or set env vars via your server's secrets manager.
      // Do NOT commit credentials to ecosystem.config.js.
      env_file: '.env',

      // Always restart on crash (PM2 default)
      autorestart: true,
      watch: false,  // Do NOT watch in production — use explicit restarts
      max_memory_restart: '512M',

      // Restart delay strategy
      min_uptime: '10s',    // If process exits before 10s, PM2 considers it crashed
      max_restarts: 5,       // After 5 crashes in a row, PM2 stops restarting

      // Logging
      out_file: '/var/log/snap-bridge/out.log',
      error_file: '/var/log/snap-bridge/err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Graceful shutdown — give the process 5s to finish in-flight requests
      kill_timeout: 5000,
      listen_timeout: 8000,

      // Environment overrides per deployment target.
      // Note: env_file is loaded first; these override specific keys.
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
    },
  ],
};
