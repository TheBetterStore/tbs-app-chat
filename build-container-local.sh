#!/bin/bash
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="tbs-chat-agent"
IMAGE_TAG="${1:-latest}"
IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

echo "==> Creating ECR repository (if not exists)..."
aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" 2>/dev/null || \
  aws ecr create-repository --repository-name "${REPO_NAME}" --region "${REGION}" --image-scanning-configuration scanOnPush=true

echo "==> Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Building ARM64 container image..."
docker buildx build --platform linux/arm64 -t "${IMAGE_URI}" --load .

echo "==> Pushing image to ECR..."
docker push "${IMAGE_URI}"

echo "==> Done. Image: ${IMAGE_URI}"
echo ""
echo "Deploy the stack with:"
echo "  sam deploy --parameter-overrides ... "
