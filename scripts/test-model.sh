#!/bin/bash
#
# Test model configuration for Hermes Agent
#

echo "=== Hermes Model Config Test ==="
echo ""

# Test 1: Read current model from Hermes config
echo "[TEST 1] Reading model from config..."
MODEL=$(hermes config get model.default 2>/dev/null || echo "")
PROVIDER=$(hermes config get model.provider 2>/dev/null || echo "")

if [ -n "$MODEL" ]; then
    echo "  ✓ Model: $MODEL"
    echo "  ✓ Provider: $PROVIDER"
else
    echo "  ✗ No model configured"
    echo "  Run: hermes model"
fi

echo ""
echo "[TEST 2] Testing hermes config set..."
hermes config set model.test_field "test_value" 2>/dev/null && echo "  ✓ hermes config set works" || echo "  ✗ hermes config set failed"

echo ""
echo "[TEST 3] Testing hermes chat command..."
hermes chat --help 2>/dev/null | head -3 || echo "  ! hermes chat not available"

echo ""
echo "=== Test Complete ==="
