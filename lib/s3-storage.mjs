export async function putS3Object(config, object) {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region: config.region });
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: object.key,
    Body: object.body,
    ContentType: object.contentType,
    ServerSideEncryption: "AES256"
  }));
}

export async function getS3Object(config, key) {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region: config.region });
  return client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: key
  }));
}

export async function deleteS3Object(config, key) {
  const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region: config.region });
  await client.send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key
  }));
}
