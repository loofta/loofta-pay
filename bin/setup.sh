#!/usr/bin/env bash
#run after gcloud auth login

valid_project_ids=("loofta")
current_project_id=$(gcloud config get-value project)
project_id="loofta"

echo "Project ID: $project_id"

if [[ ! " ${valid_project_ids[@]} " =~ " ${project_id} " ]]; then
  echo "Invalid project ID: $project_id"
  exit 1
fi

if [[ $current_project_id != $project_id ]]; then
  echo "Setting project ID to $project_id"
  gcloud config set project $project_id
fi

gcloud secrets versions access latest --secret=loofta-firebase --project=$project_id > ../service-account.json

# Check if the environment variable is set
echo $GCLOUD_SERVICE_ACCOUNT_KEY
