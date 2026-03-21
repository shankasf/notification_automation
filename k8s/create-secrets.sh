#!/bin/bash
# Create K8s secrets for MetaSource platform
# Usage: ./create-secrets.sh
#
# This script creates secrets directly in K8s. For production,
# use external-secret.yaml with the External Secrets Operator instead.

set -euo pipefail

NAMESPACE="meta-test"

echo "Creating secrets in namespace: $NAMESPACE"

# Database secret
kubectl create secret generic db-secret \
  --namespace="$NAMESPACE" \
  --from-literal=DB_HOST="${DB_HOST:?DB_HOST is required}" \
  --from-literal=DB_PORT="${DB_PORT:-5432}" \
  --from-literal=DB_USER="${DB_USER:?DB_USER is required}" \
  --from-literal=DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}" \
  --from-literal=DB_NAME="${DB_NAME:-meta_source}" \
  --from-literal=DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-meta_source}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "  db-secret created"

# Auth secret (NextAuth + Google OAuth)
kubectl create secret generic auth-secret \
  --namespace="$NAMESPACE" \
  --from-literal=NEXTAUTH_SECRET="${NEXTAUTH_SECRET:?NEXTAUTH_SECRET is required}" \
  --from-literal=GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
  --from-literal=GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "  auth-secret created"

# SMTP secret (if not already created)
kubectl create secret generic smtp-secret \
  --namespace="$NAMESPACE" \
  --from-literal=SMTP_USER="${SMTP_USER:-}" \
  --from-literal=SMTP_PASS="${SMTP_PASS:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "  smtp-secret created"

echo ""
echo "All secrets created. Verify with:"
echo "  kubectl get secrets -n $NAMESPACE"
