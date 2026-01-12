const axios = require('axios');
const sharp = require('sharp');
const convert = require('heic-convert');
const openAIService = require('../ai/openAIService');
const logger = require('../../utils/logger');

// Polyfill DOMMatrix for Node.js (required by pdfjs-dist)
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (init && typeof init === 'object') {
        this.a = init.a !== undefined ? init.a : 1;
        this.b = init.b !== undefined ? init.b : 0;
        this.c = init.c !== undefined ? init.c : 0;
        this.d = init.d !== undefined ? init.d : 1;
        this.e = init.e !== undefined ? init.e : 0;
        this.f = init.f !== undefined ? init.f : 0;
      } else {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      }
    }
  };
}

/**
 * Service for extracting structured data from receipt/invoice documents
 * Uses OpenAI Vision API for OCR and data extraction
 */
class ReceiptExtractionService {
  /**
   * Extract structured data from receipt image/document
   * @param {Buffer} fileBuffer - File buffer (image or PDF)
   * @param {string} mimeType - MIME type (image/jpeg, image/heic, application/pdf, etc.)
   * @returns {Promise<{vendor: string|null, date: string|null, amount: number|null, currency: string|null, confidence: number, raw_text: string|null}>}
   */
  async extractReceiptData(fileBuffer, mimeType) {
    try {
      // Use OpenAI Vision API for image-based extraction
      if (mimeType.startsWith('image/')) {
        return await this.extractFromImage(fileBuffer, mimeType);
      } else if (mimeType === 'application/pdf') {
        // Convert PDF to image first (process first page for multi-page PDFs)
        // Note: PDF support requires poppler-utils system package
        // Install with: brew install poppler (macOS) or apt-get install poppler-utils (Linux)
        return await this.extractFromPdf(fileBuffer);
      } else {
        return {
          vendor: null,
          date: null,
          amount: null,
          currency: null,
          confidence: 0,
          raw_text: null,
          error: `Unsupported MIME type: ${mimeType}`
        };
      }
    } catch (error) {
      logger.error('Receipt extraction error', {
        error: error.message,
        mimeType,
        stack: error.stack
      });
      return {
        vendor: null,
        date: null,
        amount: null,
        currency: null,
        confidence: 0,
        raw_text: null,
        error: error.message
      };
    }
  }

  /**
   * Convert PDF to JPEG (first page for multi-page PDFs)
   * @param {Buffer} pdfBuffer - PDF buffer
   * @returns {Promise<Buffer>} JPEG buffer
   */
  async convertPdfToJpeg(pdfBuffer) {
    try {
      // Use pdfjs-dist with canvas (no system dependencies required)
      // Note: This may have compatibility issues, but works in most cases
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
      const { createCanvas } = require('canvas');
      
      // Set worker path for Node.js
      try {
        const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
      } catch (workerError) {
        logger.warn('PDF worker setup failed', { error: workerError.message });
      }
      
      // Load PDF (convert Buffer to Uint8Array)
      const uint8Array = new Uint8Array(pdfBuffer);
      const loadingTask = pdfjsLib.getDocument({ 
        data: uint8Array,
        useSystemFonts: true,
        verbosity: 0,
        disableFontFace: true
      });
      const pdf = await loadingTask.promise;
      
      logger.info('PDF loaded', {
        pages: pdf.numPages,
        processingPage: 1,
        note: 'For multi-page PDFs, only the first page is processed'
      });
      
      // Get first page
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      
      // Create canvas
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      
      // Render using Node.js canvas-compatible approach
      // Create a render task with proper context mapping
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      });
      
      await renderTask.promise;
      
      // Convert canvas to JPEG buffer
      const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
      
      logger.info('PDF converted to JPEG', {
        pages: pdf.numPages,
        processedPage: 1,
        imageSize: jpegBuffer.length,
        imageDimensions: `${width}x${height}`
      });
      
      return jpegBuffer;
      
    } catch (error) {
      logger.error('PDF conversion error', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to convert PDF to JPEG: ${error.message}`);
    }
  }

  /**
   * Extract data from PDF by converting to image first
   * @param {Buffer} pdfBuffer - PDF buffer
   * @returns {Promise<Object>}
   */
  async extractFromPdf(pdfBuffer) {
    try {
      logger.info('Converting PDF to image for extraction');
      const jpegBuffer = await this.convertPdfToJpeg(pdfBuffer);
      return await this.extractFromImage(jpegBuffer, 'image/jpeg');
    } catch (error) {
      logger.error('PDF extraction error', {
        error: error.message,
        stack: error.stack
      });
      
      // Provide helpful error message
      let errorMessage = `PDF extraction failed: ${error.message}`;
      if (error.message.includes('Image or Canvas') || error.message.includes('DOMMatrix')) {
        errorMessage = `PDF conversion requires poppler-utils system package. Install with: brew install poppler (macOS) or apt-get install poppler-utils (Linux). For multi-page PDFs, only the first page is processed.`;
      } else {
        errorMessage += '. For multi-page PDFs, only the first page is processed.';
      }
      
      return {
        vendor: null,
        date: null,
        amount: null,
        currency: null,
        confidence: 0,
        raw_text: null,
        error: errorMessage
      };
    }
  }

  /**
   * Convert HEIC/HEIF to JPEG
   * @param {Buffer} heicBuffer - HEIC image buffer
   * @returns {Promise<Buffer>} JPEG buffer
   */
  async convertHeicToJpeg(heicBuffer) {
    try {
      // Try heic-convert first (more reliable for HEIC)
      try {
        const jpegBuffer = await convert({
          buffer: heicBuffer,
          format: 'JPEG',
          quality: 0.9
        });
        
        logger.info('HEIC converted to JPEG using heic-convert', {
          originalSize: heicBuffer.length,
          convertedSize: jpegBuffer.length
        });
        
        return Buffer.from(jpegBuffer);
      } catch (heicError) {
        // Fallback to sharp if heic-convert fails
        logger.warn('heic-convert failed, trying sharp', { error: heicError.message });
        
        const jpegBuffer = await sharp(heicBuffer)
          .jpeg({ quality: 90 })
          .toBuffer();
        
        logger.info('HEIC converted to JPEG using sharp', {
          originalSize: heicBuffer.length,
          convertedSize: jpegBuffer.length
        });
        
        return jpegBuffer;
      }
    } catch (error) {
      logger.error('HEIC conversion error', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to convert HEIC to JPEG: ${error.message}. Please convert HEIC to JPG manually or use a different format.`);
    }
  }

  /**
   * Extract data from image using OpenAI Vision API
   * @param {Buffer} imageBuffer - Image buffer
   * @param {string} mimeType - MIME type
   * @returns {Promise<Object>}
   */
  async extractFromImage(imageBuffer, mimeType) {
    if (!openAIService.enabled) {
      return {
        vendor: null,
        date: null,
        amount: null,
        currency: null,
        confidence: 0,
        raw_text: null,
        error: 'OpenAI API not configured'
      };
    }

    try {
      // Convert HEIC/HEIF to JPEG if needed
      let processedBuffer = imageBuffer;
      let processedMimeType = mimeType;
      
      if (mimeType === 'image/heic' || mimeType === 'image/heif') {
        logger.info('Converting HEIC to JPEG for OpenAI Vision API');
        processedBuffer = await this.convertHeicToJpeg(imageBuffer);
        processedMimeType = 'image/jpeg';
      }

      const base64Image = processedBuffer.toString('base64');
      const dataUrl = `data:${processedMimeType};base64,${base64Image}`;

      const prompt = `Analyze this receipt or invoice image and extract the following information in JSON format:
{
  "vendor": "company or merchant name (or null if not found)",
  "date": "date in YYYY-MM-DD format (or null if not found)",
  "amount": number (total amount as a number, or null if not found),
  "currency": "currency code like PLN, EUR, USD (or null if not found)",
  "raw_text": "all text visible in the image (optional, for debugging)"
}

IMPORTANT: If the image contains MULTIPLE receipts side-by-side or stacked:
- Extract data from the LARGEST or MOST PROMINENT receipt (usually the left one or top one)
- If receipts are clearly separate, extract from the first/main receipt
- Look for the main "SUMA PLN" or "DO ZAPŁATY" amount from the primary receipt

CRITICAL EXTRACTION RULES:
1. TOTAL AMOUNT (MOST IMPORTANT):
   - Look for the FINAL TOTAL amount at the BOTTOM of the receipt
   - Polish receipts: Look for "DO ZAPŁATY", "DO ZAPLATY", "DO ZAPŁATY PLN", "RAZEM", "SUMA PLN", "SUMA", "TOTAL"
   - The amount is usually RIGHT AFTER or NEXT TO these labels
   - If image has MULTIPLE receipts: Extract from the MAIN/LARGEST receipt (usually left or top)
   - Extract the LARGEST amount shown on the MAIN receipt (this is the final total)
   - IMPORTANT: Check if the number has 3 digits before decimal (like 649.79, not 60.79)
   - If you see "649.79" or "649,79" - extract 649.79 (NOT 60.79 or 64.79)
   - Read ALL digits carefully - 649.79 has 3 digits before decimal point
   - Include VAT/tax if it's part of the total
   - If multiple "SUMA PLN" amounts are visible, choose from the MAIN receipt (largest/most prominent)

2. VENDOR/COMPANY NAME (IMPORTANT):
   - Look at the TOP of the receipt for company name, logo, or header
   - Common locations: top center, top left, or near the receipt number
   - Extract the full business name, not just abbreviations
   - Look for company name near "PARAGON", "FAKTURA", or receipt number
   - Polish receipts: Look for company name at the very top, often in larger/bold text
   - If you see a company name, extract it completely - don't skip this field
   - Common patterns: company name before address, or in header section
   - Even if partially visible, extract what you can see

3. DATE:
   - Look for date near the top or bottom of receipt
   - Format should be YYYY-MM-DD (convert from any format you see)
   - Common labels: "Data", "Date", "Data sprzedaży", "Data wystawienia"

4. CURRENCY:
   - Usually shown next to the amount (PLN, EUR, USD, etc.)
   - Polish receipts typically use PLN
   - Look for "PLN" next to "DO ZAPŁATY" or the total amount

5. PRECISION - READ NUMBERS CAREFULLY:
   - 649.79 = six hundred forty-nine point seventy-nine (3 digits before decimal)
   - 60.79 = sixty point seventy-nine (2 digits before decimal)
   - 64.79 = sixty-four point seventy-nine (2 digits before decimal)
   - These are DIFFERENT numbers - extract the correct one!
   - If you see "649.79 PLN" or "649,79 PLN" near "DO ZAPŁATY", extract 649.79`;

      const response = await axios.post(
        `${openAIService.baseURL}/chat/completions`,
        {
          model: 'gpt-4o', // Use vision-capable model
          messages: [
            {
              role: 'system',
              content: 'You are an expert at extracting structured data from receipt and invoice images. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl
                  }
                }
              ]
            }
          ],
          temperature: 0.1, // Low temperature for consistent extraction
          max_tokens: 500,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${openAIService.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 seconds for vision API
        }
      );

      const content = response.data.choices[0].message.content;
      
      // Try to parse JSON with better error handling
      let result;
      try {
        // First, try direct parsing
        result = JSON.parse(content);
      } catch (parseError) {
        // If direct parsing fails, try to extract JSON from markdown code blocks or fix common issues
        logger.warn('Direct JSON parse failed, attempting to extract/fix JSON', {
          error: parseError.message,
          contentPreview: content.substring(0, 200)
        });
        
        let jsonString = content.trim();
        
        // Remove markdown code blocks if present
        jsonString = jsonString.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
        
        // Try to fix common JSON issues
        // Fix unterminated strings by finding and closing them
        jsonString = this.fixUnterminatedString(jsonString);
        
        // Try parsing again
        try {
          result = JSON.parse(jsonString);
        } catch (secondParseError) {
          // Try more aggressive JSON extraction and fixing
          logger.warn('Second parse attempt failed, trying aggressive fixes', {
            error: secondParseError.message,
            position: secondParseError.message.match(/position (\d+)/)?.[1]
          });
          
          // Try to extract and fix JSON more aggressively
          jsonString = this.aggressiveJsonFix(jsonString);
          
          try {
            result = JSON.parse(jsonString);
          } catch (thirdParseError) {
            // Last resort: try to extract JSON object using regex and fix it
            const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const extractedJson = this.aggressiveJsonFix(jsonMatch[0]);
                result = JSON.parse(extractedJson);
              } catch (regexParseError) {
                // Final fallback: try to extract data using regex patterns
                logger.warn('All JSON parsing failed, trying regex extraction', {
                  originalError: parseError.message,
                  regexError: regexParseError.message
                });
                
                result = this.extractDataFromText(content);
                
                if (!result || (!result.vendor && !result.amount && !result.date)) {
                  logger.error('All extraction methods failed', {
                    originalError: parseError.message,
                    secondError: secondParseError.message,
                    thirdError: thirdParseError.message,
                    regexError: regexParseError.message,
                    contentLength: content.length,
                    contentPreview: content.substring(0, 500)
                  });
                  throw new Error(`Failed to parse JSON response: ${parseError.message}. Content preview: ${content.substring(0, 200)}`);
                }
              }
            } else {
              // Try regex extraction as last resort
              result = this.extractDataFromText(content);
              if (!result || (!result.vendor && !result.amount && !result.date)) {
                throw new Error(`No JSON object found in response: ${parseError.message}`);
              }
            }
          }
        }
      }

      // Validate and normalize the extracted data
      const extracted = {
        vendor: result.vendor || null,
        date: this.normalizeDate(result.date),
        amount: this.normalizeAmount(result.amount),
        currency: this.normalizeCurrency(result.currency),
        confidence: this.calculateConfidence(result),
        raw_text: result.raw_text || null
      };

      logger.info('Receipt extraction completed', {
        vendor: extracted.vendor,
        date: extracted.date,
        amount: extracted.amount,
        currency: extracted.currency,
        confidence: extracted.confidence
      });

      return extracted;

    } catch (error) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;

      if (statusCode === 401) {
        logger.warn('OpenAI API authentication failed during receipt extraction');
      } else if (statusCode === 429) {
        logger.warn('OpenAI API rate limit exceeded during receipt extraction');
      } else {
        logger.error('OpenAI Vision API error', {
          error: errorMessage,
          statusCode
        });
      }

      return {
        vendor: null,
        date: null,
        amount: null,
        currency: null,
        confidence: 0,
        raw_text: null,
        error: `OpenAI error: ${errorMessage}`
      };
    }
  }

  /**
   * Aggressively fix JSON issues
   * @param {string} jsonString - JSON string with issues
   * @returns {string} Fixed JSON string
   */
  aggressiveJsonFix(jsonString) {
    let fixed = jsonString.trim();
    
    // Remove markdown code blocks
    fixed = fixed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    
    // Fix common issues: unclosed strings before structural characters
    // Find all string values and ensure they're properly closed
    const lines = fixed.split('\n');
    const fixedLines = [];
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      let line = lines[lineIdx];
      let inString = false;
      let escapeNext = false;
      const chars = line.split('');
      
      for (let i = 0; i < chars.length; i++) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (chars[i] === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (chars[i] === '"') {
          inString = !inString;
        }
        
        // If we hit a structural character while in a string, close it
        if (inString && (chars[i] === ':' || chars[i] === ',' || chars[i] === '}')) {
          // Insert closing quote before the structural character
          chars.splice(i, 0, '"');
          inString = false;
          i++; // Skip the inserted quote
        }
      }
      
      // If still in string at end of line, close it (unless it's the last line)
      if (inString && lineIdx < lines.length - 1) {
        chars.push('"');
      }
      
      fixedLines.push(chars.join(''));
    }
    
    fixed = fixedLines.join('\n');
    
    // Final pass: ensure all strings are closed before structural characters
    // This is a more aggressive approach
    fixed = fixed.replace(/"([^"]*?)(?=[:,\]}])/g, (match, content) => {
      // If the match doesn't end with a quote, add one
      if (!match.endsWith('"')) {
        return `"${content}"`;
      }
      return match;
    });
    
    return fixed;
  }

  /**
   * Extract data from text using regex patterns (fallback when JSON parsing fails)
   * @param {string} text - Text content from OpenAI
   * @returns {Object} Extracted data
   */
  extractDataFromText(text) {
    const result = {
      vendor: null,
      date: null,
      amount: null,
      currency: null,
      raw_text: text
    };
    
    try {
      // Try to extract vendor
      const vendorMatch = text.match(/"vendor"\s*:\s*"([^"]*)"/i) || 
                         text.match(/vendor["\s:]+([^",}\n]+)/i);
      if (vendorMatch) {
        result.vendor = vendorMatch[1]?.trim() || null;
      }
      
      // Try to extract date
      const dateMatch = text.match(/"date"\s*:\s*"([^"]*)"/i) ||
                       text.match(/date["\s:]+(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) {
        result.date = dateMatch[1] || null;
      }
      
      // Try to extract amount
      const amountMatch = text.match(/"amount"\s*:\s*([\d.]+)/i) ||
                          text.match(/amount["\s:]+([\d.,]+)/i);
      if (amountMatch) {
        const amountStr = amountMatch[1].replace(',', '.');
        result.amount = parseFloat(amountStr) || null;
      }
      
      // Try to extract currency
      const currencyMatch = text.match(/"currency"\s*:\s*"([^"]*)"/i) ||
                           text.match(/currency["\s:]+([A-Z]{3})/i);
      if (currencyMatch) {
        result.currency = currencyMatch[1]?.trim() || null;
      }
    } catch (error) {
      logger.warn('Error in regex extraction', { error: error.message });
    }
    
    return result;
  }

  /**
   * Fix unterminated strings in JSON
   * @param {string} jsonString - JSON string that may have unterminated strings
   * @returns {string} Fixed JSON string
   */
  fixUnterminatedString(jsonString) {
    let fixed = jsonString.trim();
    
    // Remove markdown code blocks if present
    fixed = fixed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    
    // Try to fix unterminated strings by finding the position of the error
    // Look for patterns like: "text without closing quote
    // Find the last opening quote that's not closed before a structural character
    let inString = false;
    let escapeNext = false;
    let lastOpenQuote = -1;
    const chars = fixed.split('');
    
    for (let i = 0; i < chars.length; i++) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (chars[i] === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (chars[i] === '"') {
        if (!inString) {
          inString = true;
          lastOpenQuote = i;
        } else {
          inString = false;
          lastOpenQuote = -1;
        }
      }
      
      // If we're in a string and hit a structural character, close the string
      if (inString && (chars[i] === ':' || chars[i] === ',' || chars[i] === '}')) {
        chars.splice(i, 0, '"');
        inString = false;
        lastOpenQuote = -1;
        break; // Only fix the first unterminated string
      }
    }
    
    // If still in a string at the end, close it before the last }
    if (inString && lastOpenQuote >= 0) {
      const lastBrace = fixed.lastIndexOf('}');
      if (lastBrace > lastOpenQuote) {
        chars.splice(lastBrace, 0, '"');
      } else {
        chars.push('"');
      }
    }
    
    return chars.join('');
  }

  /**
   * Normalize date string to YYYY-MM-DD format
   * @param {string|null} dateStr
   * @returns {string|null}
   */
  normalizeDate(dateStr) {
    if (!dateStr) return null;
    
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      return `${year}-${month}-${day}`;
    } catch {
      return null;
    }
  }

  /**
   * Normalize amount to number
   * @param {number|string|null} amount
   * @returns {number|null}
   */
  normalizeAmount(amount) {
    if (amount === null || amount === undefined) return null;
    
    const num = typeof amount === 'string' 
      ? parseFloat(amount.replace(/[^\d.,-]/g, '').replace(',', '.'))
      : Number(amount);
    
    return isNaN(num) ? null : num;
  }

  /**
   * Normalize currency code
   * @param {string|null} currency
   * @returns {string|null}
   */
  normalizeCurrency(currency) {
    if (!currency) return null;
    
    const upper = currency.toUpperCase().trim();
    const validCodes = ['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'SEK', 'NOK', 'DKK'];
    
    // Check if it's a valid 3-letter code
    if (upper.length === 3 && /^[A-Z]{3}$/.test(upper)) {
      return upper;
    }
    
    // Try to match common currency names
    const currencyMap = {
      'ZLOTY': 'PLN',
      'EURO': 'EUR',
      'DOLLAR': 'USD',
      'POUND': 'GBP'
    };
    
    return currencyMap[upper] || null;
  }

  /**
   * Calculate confidence score based on extracted fields
   * @param {Object} result
   * @returns {number} 0-100
   */
  calculateConfidence(result) {
    let score = 0;
    
    if (result.amount !== null && result.amount !== undefined) score += 40;
    if (result.date !== null) score += 30;
    if (result.currency !== null) score += 20;
    if (result.vendor !== null) score += 10;
    
    return Math.min(score, 100);
  }
}

module.exports = new ReceiptExtractionService();

