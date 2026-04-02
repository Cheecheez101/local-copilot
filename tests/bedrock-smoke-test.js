#!/usr/bin/env node

/**
 * AWS Bedrock Smoke Test
 * Verifies that AWS credentials are configured and Bedrock API is accessible
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

async function runSmokeTest() {
  console.log('🔍 AWS Bedrock Smoke Test\n');
  
  try {
    // Initialize Bedrock client
    console.log('1. Initializing Bedrock Runtime client...');
    const region = process.env.AWS_REGION || 'us-west-2';
    const client = new BedrockRuntimeClient({ region });
    console.log(`   Region: ${region}`);
    console.log('   ✓ Client initialized\n');

    // Prepare a simple test prompt
    console.log('2. Preparing test request...');
    const modelId = 'anthropic.claude-haiku-4-5-20251001-v1:0';
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: 'Say "Hello from AWS Bedrock!" and nothing else.'
        }
      ]
    };
    console.log(`   Model: ${modelId}`);
    console.log('   ✓ Request prepared\n');

    // Invoke the model
    console.log('3. Invoking Bedrock model...');
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await client.send(command);
    console.log('   ✓ Model invoked successfully\n');

    // Parse response
    console.log('4. Parsing response...');
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content[0].text;
    console.log('   ✓ Response parsed\n');

    // Display results
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SMOKE TEST PASSED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nModel Response:');
    console.log(`"${content}"`);
    console.log('\nAWS Bedrock is working correctly! 🎉\n');

    return 0;

  } catch (error) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ SMOKE TEST FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('\nError Details:');
    console.error(`Type: ${error.name}`);
    console.error(`Message: ${error.message}`);
    
    if (error.name === 'ResourceNotFoundException') {
      console.error('\n💡 The model may not be available in your region.');
      console.error('   Try enabling Claude models in the AWS Bedrock console.');
    } else if (error.name === 'UnrecognizedClientException') {
      console.error('\n💡 AWS credentials may be invalid or expired.');
      console.error('   Run: aws sts get-caller-identity');
    } else if (error.name === 'AccessDeniedException') {
      console.error('\n💡 Your AWS credentials lack Bedrock permissions.');
      console.error('   Required permission: bedrock:InvokeModel');
    } else if (error.name === 'ValidationException') {
      console.error('\n💡 Model access may not be enabled in your AWS account.');
      console.error('   1. Go to AWS Bedrock console');
      console.error('   2. Navigate to "Model access" in the left sidebar');
      console.error('   3. Click "Manage model access"');
      console.error('   4. Enable access to Anthropic Claude models');
      console.error('   5. Wait for approval (usually instant for Claude)');
    }
    
    console.error('\n');
    return 1;
  }
}

// Run the test
runSmokeTest()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
