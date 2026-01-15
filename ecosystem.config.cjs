module.exports = {
  apps: [
    {
      name: "trackify-dev",
      cwd: "/root/trackify",
      script: "npx",
      args: "tsx server/index.ts",
      env: {
        NODE_ENV: "development",
        PORT: 3002,
        NEXTAUTH_URL: "https://dev.time.ranajakub.com",
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: "10s", // Process must run 10s+ to reset restart counter
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      error_file: "/var/log/trackify-dev-error.log",
      out_file: "/var/log/trackify-dev-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "trackify-prod",
      cwd: "/root/trackify-prod",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        NEXTAUTH_URL: "https://time.ranajakub.com",
      },
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: "10s", // Process must run 10s+ to reset restart counter
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      error_file: "/var/log/trackify-prod-error.log",
      out_file: "/var/log/trackify-prod-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
