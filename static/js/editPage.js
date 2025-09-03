// --- Global variables ---
let pdfDoc = null; // PDF.js document
let pdfForm = null; // PDF form object
let formFields = []; // Will hold all form fields from the PDF
let pageNum = 1; // Current page number
let scale = 1.2; // Default scale for rendering
let totalPages = 0; // Total pages in document
let canvas = null; // Canvas element
let ctx = null; // Canvas context
let renderTask = null; // Current render task
let fieldChangeHistory = {}; // Track changes to form fields

// Field styling properties
let currentFontSize = 12;
let currentFont = 'Helvetica';
let currentTextColor = '#000000';
let currentTextAlignment = 'left';
let currentBold = false;
let currentItalic = false;

// --- Helper functions ---
function getEl(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`Element with id '${id}' not found.`);
    }
    return el;
}

// Function to display an error message
function showPDFError(message) {
    console.error(`PDF Error: ${message}`);
    
    const errorElement = document.getElementById('pdf-error');
    if (errorElement) {
        const errorMessageEl = document.getElementById('pdf-error-message');
        if (errorMessageEl) {
            errorMessageEl.textContent = `Error: ${message}`;
        }
        errorElement.classList.remove('hidden');
    }
    
    // Hide loading indicator
    const loadingElement = document.getElementById('pdf-loading');
    if (loadingElement) {
        loadingElement.classList.add('hidden');
    }
}

// Show notification
function showNotification(message, type = 'info', duration = 5000) {
    const notificationContainer = document.getElementById('notification-container');
    
    if (!notificationContainer) {
        // Create notification container if it doesn't exist
        const container = document.createElement('div');
        container.id = 'notification-container';
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = message;
    
    notification.style.padding = '12px 16px';
    notification.style.borderRadius = '6px';
    notification.style.marginBottom = '10px';
    notification.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
    notification.style.maxWidth = '400px';
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-10px)';
    notification.style.transition = 'all 0.3s ease';
    
    // Set colors based on type
    if (type === 'success') {
        notification.style.backgroundColor = '#10B981';
        notification.style.color = 'white';
    } else if (type === 'error') {
        notification.style.backgroundColor = '#EF4444';
        notification.style.color = 'white';
    } else if (type === 'warning') {
        notification.style.backgroundColor = '#F59E0B';
        notification.style.color = 'white';
    } else {
        notification.style.backgroundColor = '#3B82F6';
        notification.style.color = 'white';
    }
    
    document.getElementById('notification-container').appendChild(notification);
    
    // Trigger animation
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 10);
    
    // Remove notification after duration
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-10px)';
        
        // Remove from DOM after animation
        setTimeout(() => {
            try {
                document.getElementById('notification-container').removeChild(notification);
            } catch (e) {
                console.warn('Could not remove notification:', e);
            }
        }, 300);
    }, duration);
}

// --- PDF Loading and Rendering ---
// Wait for PDF.js library to load
async function waitForPDFJS() {
    return new Promise((resolve, reject) => {
        const maxAttempts = 20;
        let attempt = 0;
        
        const checkLib = () => {
            attempt++;
            if (typeof window.pdfjsLib !== 'undefined' && typeof window.pdfjsLib.getDocument !== 'undefined') {
                console.log("PDF.js library loaded successfully");
                resolve();
            } else if (attempt >= maxAttempts) {
                reject(new Error("PDF.js library failed to load after waiting"));
            } else {
                console.log(`Waiting for PDF.js to load (attempt ${attempt})...`);
                setTimeout(checkLib, 200);
            }
        };
        
        checkLib();
    });
}

// Wait for PDF-Lib library to load
async function waitForPDFLib() {
    return new Promise((resolve, reject) => {
        const maxAttempts = 30;
        let attempt = 0;
        
        const checkLib = () => {
            attempt++;
            if (typeof window.PDFLib !== 'undefined' && typeof window.PDFLib.PDFDocument !== 'undefined') {
                console.log("PDFLib library loaded successfully");
                resolve();
            } else if (attempt >= maxAttempts) {
                reject(new Error("PDFLib library failed to load after waiting"));
            } else {
                console.log(`Waiting for PDFLib to load (attempt ${attempt})...`);
                setTimeout(checkLib, 200);
            }
        };
        
        checkLib();
    });
}

// Initialize canvas and context
function setupCanvas() {
    canvas = document.getElementById('pdf-canvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return false;
    }
    ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('Could not get 2D context from canvas');
        return false;
    }
    console.log('Canvas setup complete');
    return true;
}

// Get PDF URL from various possible sources
function getPDFUrl() {
    // Try getting URL from global variable set in HTML
    if (typeof fileUrl !== 'undefined' && fileUrl) {
        console.log("Using fileUrl from window:", fileUrl);
        return fileUrl;
    }
    
    // Try getting URL from query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('fileId');
    
    if (fileId) {
        console.log(`Constructing PDF URL from file ID: ${fileId}`);
        return `/serve-pdf/${fileId}`;
    }
    
    // Try from pathname
    const pathSegments = window.location.pathname.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1];
    
    if (lastSegment && !isNaN(parseInt(lastSegment))) {
        console.log(`Constructing PDF URL from path segment: ${lastSegment}`);
        return `/serve-pdf/${lastSegment}`;
    }
    
    console.warn("No PDF URL could be determined");
    return null;
}

// Load PDF file and its form fields
async function loadPDF(url, options = {}) {
    if (!url) {
        console.error('No PDF URL provided');
        throw new Error('No PDF URL provided');
    }
    
    console.log('Attempting to load PDF from:', url);
    
    if (!window.pdfjsLib) {
        console.error('PDF.js library not available');
        throw new Error('PDF.js library not loaded');
    }
    
    try {
        // Show loading indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            loadingElement.classList.remove('hidden');
            const loadingText = loadingElement.querySelector('p');
            if (loadingText) loadingText.textContent = 'Loading PDF form...';
        }
        
        // First try to fetch the PDF to verify the URL works
        const response = await fetch(url, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            console.error(`HTTP error when fetching PDF: ${response.status} ${response.statusText}`);
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }
        
        const pdfBytes = await response.arrayBuffer();
        console.log('PDF bytes fetched successfully, length:', pdfBytes.byteLength);
        
        if (pdfBytes.byteLength === 0) {
            throw new Error('Retrieved PDF file is empty');
        }
        
        // Load with PDF.js for rendering
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
        pdfDoc = await loadingTask.promise;
        console.log('PDF loaded with PDF.js, pages:', pdfDoc.numPages);
        
        // Update global variables
        totalPages = pdfDoc.numPages;
        pageNum = 1;
        
        // Update page number display
        updatePageDisplay();
        
        // Extract form fields
        await extractFormFields();
        
        // Render the first page
        await renderPage(pageNum);
        
        // Hide loading indicator
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        // Show success message
        showNotification('PDF form loaded successfully. You can now fill out the form fields.', 'success');
        
        return true;
    } catch (err) {
        console.error('PDF load error:', err);
        showPDFError(err.message);
        throw err;
    }
}

// Extract form fields from PDF
async function extractFormFields() {
    if (!pdfDoc) {
        console.error('Cannot extract form fields - PDF document not loaded');
        return;
    }
    
    try {
        console.log('Extracting form fields from PDF...');
        formFields = [];
        
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const annotations = await page.getAnnotations();
            
            // Filter for form field annotations
            const fields = annotations.filter(annotation => 
                annotation.subtype === 'Widget' && 
                annotation.fieldType !== undefined
            );
            
            console.log(`Page ${i}: Found ${fields.length} form fields`);
            
            fields.forEach(field => {
                const pageSize = page.getViewport({ scale: 1 });
                
                // Convert PDF coordinates to canvas coordinates
                // PDF coordinates start at bottom-left, canvas coordinates at top-left
                const rect = field.rect; // [x1, y1, x2, y2]
                
                const x = rect[0];
                const y = pageSize.height - rect[3]; // Flip y-coordinate
                const width = rect[2] - rect[0];
                const height = rect[3] - rect[1];
                
                formFields.push({
                    id: field.id,
                    name: field.fieldName || 'unnamed_field',
                    type: field.fieldType,
                    value: field.fieldValue || '',
                    defaultValue: field.defaultFieldValue || '',
                    page: i,
                    rect: rect,
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    options: field.options || [],
                    multiline: field.multiLine || false,
                    readOnly: field.readOnly || false,
                    required: field.required || false,
                    pageIndex: i - 1  // 0-based page index
                });
            });
        }
        
        // Update the fields panel
        updateFieldsPanel();
        
        console.log('Total form fields extracted:', formFields.length);
        return formFields.length;
    } catch (err) {
        console.error('Error extracting form fields:', err);
        showNotification('Error loading form fields', 'error');
        return 0;
    }
}

// Render current PDF page
async function renderPage(num) {
    console.log(`Rendering PDF page ${num}`);
    if (!pdfDoc) {
        console.error('Cannot render - PDF document not loaded');
        return;
    }
    
    if (!canvas || !ctx) {
        console.error('Canvas or context not initialized');
        if (!setupCanvas()) {
            showPDFError('Canvas initialization failed');
            return;
        }
    }
    
    try {
        // Update current page number
        pageNum = num;
        
        // Show loading indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            loadingElement.classList.remove('hidden');
        }
        
        // Get the page
        const page = await pdfDoc.getPage(num);
        
        // Calculate viewport
        const viewport = page.getViewport({ scale });
        
        // Set canvas dimensions
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Render the page
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        renderTask = page.render(renderContext);
        await renderTask.promise;
        
        // Draw form field overlays
        drawFormFieldOverlays(page, viewport);
        
        // Hide loading indicator
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        // Update page number display
        updatePageDisplay();
        
        console.log(`PDF page ${num} rendered successfully`);
        
        // Update the fields list to highlight fields on current page
        updateFieldsPanel();
    } catch (err) {
        console.error('Error rendering PDF page:', err);
        showPDFError(`Error rendering page ${num}: ${err.message}`);
    }
}

// Draw overlays for form fields
function drawFormFieldOverlays(page, viewport) {
    if (!ctx) return;
    
    const currentPageFields = formFields.filter(field => field.page === pageNum);
    
    currentPageFields.forEach(field => {
        // Calculate position using viewport transform for proper scaling
        const fieldRect = viewport.convertToViewportRectangle(field.rect);
        const x = fieldRect[0];
        const y = fieldRect[1];
        const width = fieldRect[2] - fieldRect[0];
        const height = fieldRect[3] - fieldRect[1];
        
        // Subtle highlight for form fields
        ctx.fillStyle = 'rgba(173, 216, 230, 0.1)'; // Light blue with low opacity
        ctx.fillRect(x, y, width, height);
        
        // Border for the field
        ctx.strokeStyle = 'rgba(30, 144, 255, 0.5)'; // Dodger blue with 50% opacity
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);
        
        // Add field name as a small label above the field
        ctx.font = '10px Arial';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        
        // Field type icon
        let icon = '';
        switch (field.type) {
            case 'text': icon = '📝 '; break;
            case 'checkbox': icon = '☐ '; break;
            case 'radiobutton': icon = '○ '; break;
            case 'combobox': icon = '▼ '; break;
            case 'listbox': icon = '▤ '; break;
            case 'signature': icon = '✍️ '; break;
            default: icon = '📄 ';
        }
        
        // Truncate long field names
        const displayName = field.name.length > 20 ? field.name.substring(0, 18) + '...' : field.name;
        ctx.fillText(`${icon}${displayName}`, x, y - 2);
        
        // Show current value if there is one
        if (field.value) {
            const valueText = field.value.length > 20 ? field.value.substring(0, 18) + '...' : field.value;
            ctx.fillText(`Value: ${valueText}`, x + width - ctx.measureText(`Value: ${valueText}`).width, y - 2);
        }
    });
}

// Update page number display
function updatePageDisplay() {
    const pageNumberInput = getEl('page-number');
    const pageCountSpan = getEl('page-count');
    
    if (pageNumberInput) {
        pageNumberInput.value = pageNum;
    }
    
    if (pageCountSpan) {
        pageCountSpan.textContent = totalPages;
    }
}

// --- Form Field Interaction --

// Update the fields panel with current form fields
function updateFieldsPanel() {
    const fieldsContainer = getEl('fields-container');
    if (!fieldsContainer) return;
    
    fieldsContainer.innerHTML = '';
    
    if (formFields.length === 0) {
        fieldsContainer.innerHTML = '<p class="no-fields-message">No form fields found in this PDF.</p>';
        return;
    }
    
    // Group fields by page
    const fieldsByPage = {};
    formFields.forEach(field => {
        if (!fieldsByPage[field.page]) {
            fieldsByPage[field.page] = [];
        }
        fieldsByPage[field.page].push(field);
    });
    
    // Create section for each page
    Object.keys(fieldsByPage).sort((a, b) => parseInt(a) - parseInt(b)).forEach(page => {
        const pageFields = fieldsByPage[page];
        
        // Create page section
        const pageSection = document.createElement('div');
        pageSection.className = 'fields-page-section';
        pageSection.innerHTML = `
            <h3 class="page-section-header ${parseInt(page) === pageNum ? 'current-page' : ''}">
                Page ${page} 
                <span class="field-count">(${pageFields.length} field${pageFields.length === 1 ? '' : 's'})</span>
                <button class="go-to-page-btn" data-page="${page}">View</button>
            </h3>
        `;
        
        // Add click event for "View" button
        const viewBtn = pageSection.querySelector('.go-to-page-btn');
        viewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = parseInt(e.target.getAttribute('data-page'));
            if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
                pageNum = targetPage;
                renderPage(pageNum);
            }
        });
        
        const fieldsList = document.createElement('div');
        fieldsList.className = 'fields-list';
        
        // Add each field
        pageFields.forEach(field => {
            const fieldItem = document.createElement('div');
            fieldItem.className = 'field-item';
            fieldItem.setAttribute('data-field-id', field.id);
            
            // Determine icon based on field type
            let fieldIcon, fieldControl;
            
            switch (field.type) {
                case 'text':
                    fieldIcon = '<span class="field-icon">📝</span>';
                    fieldControl = `<input type="text" class="field-input" value="${field.value || ''}" placeholder="Enter text..." ${field.readOnly ? 'disabled' : ''}>`;
                    break;
                    
                case 'checkbox':
                    fieldIcon = '<span class="field-icon">☐</span>';
                    fieldControl = `<input type="checkbox" class="field-checkbox" ${field.value ? 'checked' : ''} ${field.readOnly ? 'disabled' : ''}>`;
                    break;
                    
                case 'radiobutton':
                    fieldIcon = '<span class="field-icon">○</span>';
                    fieldControl = `<input type="radio" class="field-radio" ${field.value ? 'checked' : ''} ${field.readOnly ? 'disabled' : ''}>`;
                    break;
                    
                case 'combobox':
                case 'listbox':
                    fieldIcon = '<span class="field-icon">▼</span>';
                    let optionsHtml = '';
                    if (field.options && field.options.length) {
                        field.options.forEach(option => {
                            optionsHtml += `<option value="${option}" ${field.value === option ? 'selected' : ''}>${option}</option>`;
                        });
                    }
                    fieldControl = `<select class="field-select" ${field.readOnly ? 'disabled' : ''}>${optionsHtml}</select>`;
                    break;
                    
                case 'signature':
                    fieldIcon = '<span class="field-icon">✍️</span>';
                    fieldControl = `<button class="signature-btn">Add Signature</button>`;
                    break;
                    
                default:
                    fieldIcon = '<span class="field-icon">📄</span>';
                    fieldControl = `<input type="text" class="field-input" value="${field.value || ''}" placeholder="Enter value..." ${field.readOnly ? 'disabled' : ''}>`;
            }
            
            fieldItem.innerHTML = `
                <div class="field-header">
                    ${fieldIcon}
                    <span class="field-name" title="${field.name}">${field.name}</span>
                    ${field.required ? '<span class="required-marker">*</span>' : ''}
                    ${field.readOnly ? '<span class="readonly-marker">🔒</span>' : ''}
                </div>
                <div class="field-control">
                    ${fieldControl}
                </div>
            `;
            
            // Add event listeners for field inputs
            const inputElement = fieldItem.querySelector('.field-input, .field-checkbox, .field-radio, .field-select');
            if (inputElement) {
                inputElement.addEventListener('change', function() {
                    let newValue;
                    
                    if (this.type === 'checkbox' || this.type === 'radio') {
                        newValue = this.checked ? 'Yes' : 'Off';
                    } else {
                        newValue = this.value;
                    }
                    
                    // Update the field
                    updateFieldValue(field.id, newValue);
                    
                    // If we're on the page with this field, redraw
                    if (field.page === pageNum) {
                        renderPage(pageNum);
                    }
                });
            }
            
            // Add event listener for signature button
            const signatureBtn = fieldItem.querySelector('.signature-btn');
            if (signatureBtn) {
                signatureBtn.addEventListener('click', function() {
                    openSignatureEditor(field.id);
                });
            }
            
            // Add to fields list
            fieldsList.appendChild(fieldItem);
        });
        
        pageSection.appendChild(fieldsList);
        fieldsContainer.appendChild(pageSection);
    });
}

// Update a field's value
function updateFieldValue(fieldId, value) {
    const fieldIndex = formFields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) {
        console.error(`Field with ID ${fieldId} not found`);
        return false;
    }
    
    const field = formFields[fieldIndex];
    
    // Store previous value for history
    if (!fieldChangeHistory[fieldId]) {
        fieldChangeHistory[fieldId] = [];
    }
    fieldChangeHistory[fieldId].push(field.value);
    
    // Update the value
    field.value = value;
    console.log(`Updated field "${field.name}" (${fieldId}) with value: ${value}`);
    
    return true;
}

// Open signature editor
function openSignatureEditor(fieldId) {
    const field = formFields.find(f => f.id === fieldId);
    if (!field) {
        console.error(`Field with ID ${fieldId} not found`);
        return;
    }
    
    // Create modal for signature
    const modal = document.createElement('div');
    modal.className = 'signature-modal';
    modal.innerHTML = `
        <div class="signature-container">
            <h3>Add Signature</h3>
            <div class="signature-pad-container">
                <canvas id="signature-pad" width="400" height="200"></canvas>
            </div>
            <div class="signature-buttons">
                <button id="clear-signature" class="button">Clear</button>
                <button id="cancel-signature" class="button button-secondary">Cancel</button>
                <button id="save-signature" class="button button-primary">Add Signature</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Initialize signature pad
    const canvas = document.getElementById('signature-pad');
    const signaturePad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        penColor: 'black'
    });
    
    // Handle buttons
    document.getElementById('clear-signature').addEventListener('click', () => {
        signaturePad.clear();
    });
    
    document.getElementById('cancel-signature').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    document.getElementById('save-signature').addEventListener('click', () => {
        if (signaturePad.isEmpty()) {
            alert('Please provide a signature');
            return;
        }
        
        // Get signature as data URL
        const signatureImage = signaturePad.toDataURL();
        
        // Update field value with signature image
        updateFieldValue(fieldId, signatureImage);
        
        // Close modal
        document.body.removeChild(modal);
        
        // Re-render if on current page
        if (field.page === pageNum) {
            renderPage(pageNum);
        }
        
        // Update fields panel
        updateFieldsPanel();
    });
}

// --- PDF Navigation ---

// Navigate to previous page
function prevPage() {
    if (pageNum <= 1) return;
    pageNum--;
    renderPage(pageNum);
}

// Navigate to next page
function nextPage() {
    if (pageNum >= totalPages) return;
    pageNum++;
    renderPage(pageNum);
}

// Go to specific page
function goToPage(num) {
    if (num < 1 || num > totalPages) return;
    pageNum = num;
    renderPage(pageNum);
}

// --- Saving Filled PDF ---

// Save filled PDF form
async function saveFilledPDF(filename) {
    try {
        console.log('Starting to save filled PDF...');
        
        // Show saving indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            const loadingText = loadingElement.querySelector('p');
            if (loadingText) loadingText.textContent = 'Saving PDF form...';
            loadingElement.classList.remove('hidden');
        }
        
        // Get the PDF URL
        const url = getPDFUrl();
        if (!url) {
            throw new Error('Could not determine PDF URL');
        }
        
        // Fetch the PDF
        const response = await fetch(url, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }
        
        const pdfBytes = await response.arrayBuffer();
        
        // Wait for PDFLib to be available
        await waitForPDFLib();
        
        // Load PDF document with PDFLib
        const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
        console.log('PDF loaded with PDFLib for saving');
        
        // Get the form from the PDF
        const form = pdfDoc.getForm();
        
        // Update form fields with values from our formFields array
        for (const field of formFields) {
            try {
                if (!field.name || field.name === 'unnamed_field') continue;
                
                const formField = form.getFieldMaybe(field.name);
                if (!formField) {
                    console.warn(`Could not find field "${field.name}" in the PDF form`);
                    continue;
                }
                
                console.log(`Updating field "${field.name}" with value:`, field.value);
                
                if (field.type === 'text') {
                    // Text field
                    const textField = formField;
                    if (typeof textField.setText === 'function') {
                        textField.setText(field.value);
                    }
                } else if (field.type === 'checkbox') {
                    // Checkbox
                    const checkBox = formField;
                    if (field.value === 'Yes' || field.value === true) {
                        if (typeof checkBox.check === 'function') checkBox.check();
                    } else {
                        if (typeof checkBox.uncheck === 'function') checkBox.uncheck();
                    }
                } else if (field.type === 'radiobutton') {
                    // Radio button
                    const radioGroup = formField;
                    if (typeof radioGroup.select === 'function') {
                        radioGroup.select(field.value);
                    }
                } else if (field.type === 'combobox' || field.type === 'listbox') {
                    // Dropdown
                    const dropdown = formField;
                    if (typeof dropdown.select === 'function') {
                        dropdown.select(field.value);
                    }
                } else if (field.type === 'signature') {
                    // We would need additional handling for signatures
                    console.log('Signature fields are not yet supported for saving');
                }
            } catch (fieldError) {
                console.warn(`Error updating field "${field.name}":`, fieldError);
            }
        }
        
        // Set the NeedAppearances flag to ensure fields render correctly
        const acroForm = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFLib.PDFName.of('AcroForm')));
        if (acroForm) {
            // Ensure NeedAppearances flag is set to make fields visible in all PDF readers
            acroForm.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True);
            
            // Ensure DA (Default Appearance) is present in the AcroForm dictionary
            const defaultAppearance = acroForm.get(PDFLib.PDFName.of('DA'));
            if (!defaultAppearance) {
                // Set a default appearance string if none exists
                acroForm.set(PDFLib.PDFName.of('DA'), PDFLib.PDFString.of('/Helv 0 Tf 0 g'));
            }
            
            // Make sure we have a DR (Document Resources) dictionary
            let drDict = acroForm.get(PDFLib.PDFName.of('DR'));
            if (!drDict) {
                drDict = pdfDoc.context.obj({});
                acroForm.set(PDFLib.PDFName.of('DR'), drDict);
            }
            
            // Ensure there's a Font dictionary in DR
            let fontDict = drDict.get(PDFLib.PDFName.of('Font'));
            if (!fontDict) {
                fontDict = pdfDoc.context.obj({});
                drDict.set(PDFLib.PDFName.of('Font'), fontDict);
                
                // Add at least Helvetica font to the Font dictionary
                const helveticaRef = pdfDoc.context.register(
                    pdfDoc.context.obj({
                        Type: PDFLib.PDFName.of('Font'),
                        Subtype: PDFLib.PDFName.of('Type1'),
                        BaseFont: PDFLib.PDFName.of('Helvetica')
                    })
                );
                fontDict.set(PDFLib.PDFName.of('Helv'), helveticaRef);
            }
        }
        
        // Generate PDF bytes with options that help ensure field visibility
        const filledPdfBytes = await pdfDoc.save({ 
            useObjectStreams: false,
            addDefaultAppearance: true,
            updateFieldAppearances: true
        });
        
        // Collect form field data for metadata storage
        const fieldMetadata = {};
        for (const field of formFields) {
            if (field.name && field.name !== 'unnamed_field') {
                fieldMetadata[field.name] = {
                    value: field.value,
                    type: field.type
                };
            }
        }

        // Create form data for server upload
        const formData = new FormData();
        formData.append('file', new File([filledPdfBytes], filename, { type: 'application/pdf' }));
        
        // Get the file ID from the URL
        const fileId = getFileIdFromUrl();
        
        // Add metadata for the filled form
        formData.append('sourceFileId', fileId);
        formData.append('formData', JSON.stringify(fieldMetadata));
        formData.append('type', 'filled');
        
        console.log('Uploading filled PDF to server...');
        const saveResponse = await fetch('/save-filled-form', {
            method: 'POST',
            body: formData
        });
        
        const result = await saveResponse.json();
        
        // Hide loading indicator
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        if (result.success) {
            console.log('Filled PDF form saved successfully with ID:', result.id);
            showNotification('Filled PDF form saved successfully!', 'success');
            
            // Download a copy for the user
            const blob = new Blob([filledPdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            return true;
        } else {
            console.error('Error saving filled PDF form:', result.error);
            showNotification('Error saving filled form: ' + result.error, 'error');
            return false;
        }
    } catch (err) {
        console.error('Error saving filled PDF:', err);
        showNotification('Error saving filled PDF: ' + err.message, 'error');
        
        // Hide loading indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        return false;
    }
}

// --- User Interface Event Handlers ---

// Document initialization
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Editor page initializing...');
    
    // Setup canvas
    if (!setupCanvas()) {
        alert('Could not initialize the PDF canvas. Please refresh and try again.');
        return;
    }
    
    // Setup event handlers
    setupEventHandlers();
    
    // Try to load PDF
    const url = getPDFUrl();
    if (!url) {
        showPDFError('No PDF file specified. Please select a form to edit.');
        return;
    }
    
    try {
        // Wait for library to load
        await waitForPDFJS();
        
        // Load and render PDF
        await loadPDF(url);
    } catch (err) {
        console.error('Failed to initialize editor:', err);
        showPDFError(err.message);
    }
});

// Setup event handlers for UI elements
function setupEventHandlers() {
    // Page navigation
    const prevBtn = getEl('prev-page');
    const nextBtn = getEl('next-page');
    const pageInput = getEl('page-number');
    
    if (prevBtn) prevBtn.addEventListener('click', prevPage);
    if (nextBtn) nextBtn.addEventListener('click', nextPage);
    if (pageInput) {
        pageInput.addEventListener('change', function() {
            const page = parseInt(this.value);
            if (!isNaN(page) && page >= 1 && page <= totalPages) {
                goToPage(page);
            } else {
                this.value = pageNum;
            }
        });
    }
    
    // Text formatting buttons
    const fontSizeSelect = getEl('font-size');
    const fontFamilySelect = getEl('font-family');
    const textColorInput = getEl('text-color');
    const boldBtn = getEl('bold-btn');
    const italicBtn = getEl('italic-btn');
    
    if (fontSizeSelect) {
        fontSizeSelect.addEventListener('change', function() {
            currentFontSize = parseInt(this.value);
        });
    }
    
    if (fontFamilySelect) {
        fontFamilySelect.addEventListener('change', function() {
            currentFont = this.value;
        });
    }
    
    if (textColorInput) {
        textColorInput.addEventListener('change', function() {
            currentTextColor = this.value;
        });
    }
    
    if (boldBtn) {
        boldBtn.addEventListener('click', function() {
            currentBold = !currentBold;
            this.classList.toggle('active');
        });
    }
    
    if (italicBtn) {
        italicBtn.addEventListener('click', function() {
            currentItalic = !currentItalic;
            this.classList.toggle('active');
        });
    }
    
    // Save button
    const saveBtn = getEl('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            // Show save modal
            const saveModal = getEl('save-modal');
            if (saveModal) {
                const fileNameInput = getEl('save-filename');
                if (fileNameInput) {
                    // Generate default filename
                    const urlParams = new URLSearchParams(window.location.search);
                    const fileId = urlParams.get('fileId') || window.location.pathname.split('/').pop();
                    
                    const date = new Date();
                    const timestamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
                    
                    fileNameInput.value = `filled_form_${timestamp}.pdf`;
                }
                saveModal.style.display = 'flex';
            }
        });
    }
    
    // Cancel save button
    const cancelSaveBtn = getEl('cancel-save');
    if (cancelSaveBtn) {
        cancelSaveBtn.addEventListener('click', function() {
            const saveModal = getEl('save-modal');
            if (saveModal) {
                saveModal.style.display = 'none';
            }
        });
    }
    
    // Confirm save button
    const confirmSaveBtn = getEl('confirm-save');
    if (confirmSaveBtn) {
        confirmSaveBtn.addEventListener('click', async function() {
            const fileNameInput = getEl('save-filename');
            let filename = fileNameInput ? fileNameInput.value : 'filled_form.pdf';
            
            // Ensure filename ends with .pdf
            if (!filename.toLowerCase().endsWith('.pdf')) {
                filename += '.pdf';
            }
            
            // Hide modal
            const saveModal = getEl('save-modal');
            if (saveModal) {
                saveModal.style.display = 'none';
            }
            
            // Save the filled PDF
            const success = await saveFilledPDF(filename);
            if (success) {
                // Redirect back to saved files page after short delay
                setTimeout(() => {
                    window.location.href = '/saved_files';
                }, 1500);
            }
        });
    }
}
