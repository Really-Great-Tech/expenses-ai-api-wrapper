// Citation JSON Schema Variable for LangSmith Prompt Template

const citationSchema = {
  "citations": {
    "field_name": {
      "field_citation": {
        "source_text": "exact_text_from_source",
        "confidence": 0.95,
        "source_location": "markdown",
        "context": "surrounding_text_for_validation",
        "match_type": "exact|fuzzy|contextual"
      },
      "value_citation": {
        "source_text": "exact_text_from_source",
        "confidence": 0.95,
        "source_location": "markdown",
        "context": "surrounding_text_for_validation",
        "match_type": "exact|fuzzy|contextual"
      }
    }
  },
  "metadata": {
    "total_fields_analyzed": 10,
    "fields_with_field_citations": 8,
    "fields_with_value_citations": 9,
    "average_confidence": 0.87
  }
};

// Convert to formatted JSON string for prompt template
const jsonSchemaString = JSON.stringify(citationSchema, null, 2);

console.log('Schema variable for LangSmith prompt:');
console.log('Variable name: jsonSchema');
console.log('Variable value:');
console.log(jsonSchemaString);

// Example of how to use in prompt template:
console.log('\n--- Example Usage in LangSmith Prompt ---');
console.log('In your LangSmith prompt template, use: {jsonSchema}');
console.log('The variable will be replaced with the formatted JSON schema above.');

// Export for use in your application
module.exports = {
  citationSchema,
  jsonSchemaString
};
