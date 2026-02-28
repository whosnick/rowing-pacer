// utils/templateEngine.js - Template placeholder replacement utility

/**
 * Renders a template string by replacing placeholders with values from context.
 * Placeholders are in the format {key}.
 * @param {string} template - The template string with {placeholders}
 * @param {Object} context - Object containing values for placeholders
 * @returns {string} - Rendered string with placeholders replaced
 */
export function renderTemplate(template, context) {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return context[key] !== undefined ? context[key] : match;
  });
}