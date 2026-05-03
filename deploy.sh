export environment=prod
export deployBucket=$MY_DEPLOY_BUCKET

export appName=tbs-app-chat
export kmsCFStackName="tbs-sec-kms-${environment}"
export stackName=$appName-$environment

#npm run build

export braveApiKeyParam="/${stackName}/BraveApi/Key"

internalKmsKeyId=$(aws cloudformation list-exports --query "Exports[?Name=='${kmsCFStackName}:InternalKmsKey:Id'].Value" --output text)
echo internalKmsKeyId=$internalKmsKeyId

aws ssm put-parameter \
  --name "${braveApiKeyParam}" \
  --value "TBA" \
  --type SecureString \
  --key-id "${internalKmsKeyId}" \
  --no-overwrite

# sam package --template-file ./template.yaml --output-template-file generated-template.yaml --s3-bucket $DEPLOY_BUCKET
sam build --cached
#sam build

sam deploy --template-file .aws-sam/build/template.yaml --stack-name $stackName \
--s3-bucket $deployBucket --s3-prefix $appName \
--capabilities CAPABILITY_NAMED_IAM --region ap-southeast-2 --parameter-overrides Environment=$environment \
AppLoginCFName=tbs-app-login-$environment \
InfraBaseCFName=tbs-infra-$environment \
KmsCFStackName=$kmsCFStackName \
AllowedCorsDomains="http://localhost:4200,https://thebetterstore.net" \
BedrockModel="global.anthropic.claude-sonnet-4-5-20250929-v1:0" \
BraveApiKeyParam="${braveApiKeyParam}" \
--no-fail-on-empty-changeset \
--tags Environment=$Environment StackName=$STACK_NAME TagProduct=$APP_NAME \
--profile thebetterstore
