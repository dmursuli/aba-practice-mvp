module.exports = {
  apps: [
    {
      name: "aba-practice",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3000",
        APP_BASE_URL: "https://app.triumphbehavioral.com",
        DATA_STORE: "postgres",
        DOCUMENT_STORE: "s3",
        DB_HOST: "database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com",
        DB_PORT: "5432",
        DB_NAME: "postgres",
        DB_USER: "aba_admin",
        DB_SSL: "true",
        DB_SSL_REJECT_UNAUTHORIZED: "true",
        AWS_REGION: "us-east-1",
        S3_BUCKET: "triumph-aba-uploads-prod"
      }
    }
  ]
};
