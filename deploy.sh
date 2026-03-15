export Environment=prod
export DEPLOY_BUCKET=$MY_DEPLOY_BUCKET

export APP_NAME=tbs-app-chat
export STACK_NAME=$APP_NAME-$Environment

#npm run build

# sam package --template-file ./template.yaml --output-template-file generated-template.yaml --s3-bucket $DEPLOY_BUCKET
sam build --cached
#sam build

sam deploy --template-file .aws-sam/build/template.yaml --stack-name $STACK_NAME \
--s3-bucket $DEPLOY_BUCKET --s3-prefix $APP_NAME \
--capabilities CAPABILITY_NAMED_IAM --region ap-southeast-2 --parameter-overrides Environment=$Environment \
AppLoginCFName=tbs-app-login-$Environment \
InfraBaseCFName=tbs-infra-$Environment \
--no-fail-on-empty-changeset \
--tags Environment=$Environment StackName=$STACK_NAME TagProduct=$APP_NAME \
--profile thebetterstore
