/**
 * Design Page JavaScript for PDF Portfolio approach
 * 
 * This script handles:
 * - Loading a PDF for design using PDF.js
 * - Adding/repositioning form fields on the PDF
 * - Saving form fields to generate a surface PDF with AcroForm fields
 */

// Initialize global variables
let pdfDoc = null;
let pdfCanvas = null;
let pdfContext = null;
let pdfPage = null;
let pdfZoom = 1.0;
let currentPage = 1;
let totalPages = 0;
let currentScale = 1.0;
let fieldCounter = 0;
let formFields = [];
let activeField = null;
let isDragging = false;
let startX = 0;
let startY = 0;
let fieldTypeToAdd = null;
let isPlacingField = false;
let formData = {
    fileId: null,
    schema: {
        fields: []
    }
};

// DOM Elements
let pdfContainer = null;
let formOverlay = null;
let pageInfo = null;

// Field type definitions
const fieldTypes = {
    text: { label: 'Text Input', icon: 'edit', defaultHeight: 40, defaultWidth: 200 },
    checkbox: { label: 'Checkbox', icon: 'check_box', defaultHeight: 40, defaultWidth: 40 },
    signature: { label: 'Signature', icon: 'draw', defaultHeight: 80, defaultWidth: 200 },
    date: { label: 'Date Field', icon: 'calendar_today', defaultHeight: 40, defaultWidth: 200 }
};

// DOM Elements (will be initialized after document loads)
let fieldToolbar, fieldProperties, pageControls;

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    bindEventListeners();
    bindZoomControls();
    loadPDF();
    
    // Set up PDF container for field placement
    setupPdfContainer();
});

/**
 * Bind event listeners for the zoom toolbar
 */
function bindZoomControls() {
    // Zoom in button
    document.getElementById('zoom-in')?.addEventListener('click', () => {
        currentScale += 0.1;
        renderPage(currentPage);
        document.getElementById('zoom-level').textContent = `${Math.round(currentScale * 100)}%`;
    });
    
    // Zoom out button
    document.getElementById('zoom-out')?.addEventListener('click', () => {
        if (currentScale > 0.2) {
            currentScale -= 0.1;
            renderPage(currentPage);
            document.getElementById('zoom-level').textContent = `${Math.round(currentScale * 100)}%`;
        }
    });
}

/**
 * Initialize UI elements
 */
function initializeUI() {
    // Get file ID from DOM
    const fileId = document.body.getAttribute('data-file-id');
    formData.fileId = fileId;
    
    // Initialize DOM elements
    pdfCanvas = document.getElementById('pdf-canvas');
    
    // If pdf-container doesn't exist, create it
    pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer && pdfCanvas) {
        // Create container
        pdfContainer = document.createElement('div');
        pdfContainer.id = 'pdf-container';
        pdfContainer.className = 'pdf-container';
        pdfContainer.style.position = 'relative';
        
        // Wrap canvas
        const parent = pdfCanvas.parentElement;
        parent.insertBefore(pdfContainer, pdfCanvas);
        pdfContainer.appendChild(pdfCanvas);
        
        // Create form overlay
        formOverlay = document.createElement('div');
        formOverlay.id = 'form-overlay';
        formOverlay.style.position = 'absolute';
        formOverlay.style.top = '0';
        formOverlay.style.left = '0';
        formOverlay.style.width = '100%';
        formOverlay.style.height = '100%';
        formOverlay.style.zIndex = '2';
        pdfContainer.appendChild(formOverlay);
    } else {
        formOverlay = document.getElementById('form-overlay');
        // If formOverlay doesn't exist, create it
        if (!formOverlay && pdfContainer) {
            formOverlay = document.createElement('div');
            formOverlay.id = 'form-overlay';
            formOverlay.style.position = 'absolute';
            formOverlay.style.top = '0';
            formOverlay.style.left = '0';
            formOverlay.style.width = '100%';
            formOverlay.style.height = '100%';
            formOverlay.style.zIndex = '2';
            pdfContainer.appendChild(formOverlay);
        }
    }
    
    if (pdfCanvas) {
        pdfContext = pdfCanvas.getContext('2d');
    }
    
    // Create PDF viewer container
    const editorArea = document.querySelector('.content-card:nth-child(2)');
    if (editorArea) {
        editorArea.innerHTML = `
            <!-- Removed editor-header with page controls as requested -->
            <div class="editor-content">
                <div id="pdf-container" class="pdf-container">
                    <canvas id="pdf-canvas"></canvas>
                    <div id="form-overlay"></div>
                    <div id="loading-indicator">Loading PDF...</div>
                </div>
            </div>
            <div class="editor-footer">
                <button id="save-button" class="button button-primary">
                    <i class="material-icons">save</i> Save Form
                </button>
            </div>
        `;
    }
    
    // Create form tools panel
    const toolsPanel = document.querySelector('.form-tools');
    if (toolsPanel) {
        toolsPanel.innerHTML = `
            <h3>Form Fields</h3>
            <div class="form-fields-list">
                ${Object.entries(fieldTypes).map(([type, field]) => `
                    <button class="form-field-btn" data-type="${type}" title="${field.label}">
                        <i class="material-icons">${field.icon}</i>
                        <span>${field.label}</span>
                    </button>
                `).join('')}
            </div>
        `;
    }
    
    // Initialize field properties panel
    const propertiesPanel = document.querySelector('.content-card:nth-child(3)');
    if (propertiesPanel) {
        propertiesPanel.innerHTML = `
            <h3>Field Properties</h3>
            <div id="field-properties" class="field-properties">
                <p class="no-field-selected">No field selected. Add or select a field to edit its properties.</p>
                <div class="field-property-form" style="display: none;">
                    <div class="form-group">
                        <label for="field-name">Field Name:</label>
                        <input type="text" id="field-name" class="form-control">
                    </div>
                    <div class="form-group">
                        <label for="field-type">Field Type:</label>
                        <select id="field-type" class="form-control">
                            <option value="text">Text</option>
                            <option value="checkbox">Checkbox</option>
                            <option value="signature">Signature</option>
                            <option value="date">Date</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="field-required">Required:</label>
                        <input type="checkbox" id="field-required">
                    </div>
                    <div class="form-group">
                        <label for="field-default">Default Value:</label>
                        <input type="text" id="field-default" class="form-control">
                    </div>
                    <div class="form-group">
                        <button id="delete-field" class="button button-danger">
                            <i class="material-icons">delete</i> Delete Field
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Get references to DOM elements
    pdfContainer = document.getElementById('pdf-container');
    pdfCanvas = document.getElementById('pdf-canvas');
    pdfContext = pdfCanvas.getContext('2d');
    formOverlay = document.getElementById('form-overlay');
    // Removed pageInfo reference as the top header was removed
    pageInfo = null; // Set to null since we removed the element
    fieldToolbar = document.querySelector('.form-fields-list');
    fieldProperties = document.getElementById('field-properties');
    saveButton = document.getElementById('save-button');
    
    // Add Material Icons if not already in the document
    if (!document.querySelector('link[href*="material-icons"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        document.head.appendChild(link);
    }
}

/**
 * Bind event listeners
 */
function bindEventListeners() {
    // Page navigation
    document.getElementById('prev-page')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage(currentPage);
        }
    });
    
    document.getElementById('next-page')?.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderPage(currentPage);
        }
    });
    
    // We don't need to bind zoom controls here as they're handled in bindZoomControls()
    
    // Field type selection
    document.querySelectorAll('.form-field-btn').forEach(button => {
        const fieldType = button.getAttribute('data-type');
        if (fieldType) {
            button.addEventListener('click', () => {
                selectFieldType(fieldType);
            });
            console.log(`Bound click handler for ${fieldType} field button`);
        } else {
            console.warn('Field button missing data-type attribute:', button);
        }
    });
    
    // Save button
    document.getElementById('save-button')?.addEventListener('click', saveForm);
    document.getElementById('save-btn')?.addEventListener('click', showSaveModal);
    document.getElementById('confirm-save')?.addEventListener('click', saveForm);
    document.getElementById('cancel-save')?.addEventListener('click', hideSaveModal);
    
    // Field property changes
    document.getElementById('field-name')?.addEventListener('change', updateSelectedField);
    document.getElementById('field-type')?.addEventListener('change', updateSelectedField);
    document.getElementById('field-required')?.addEventListener('change', updateSelectedField);
    document.getElementById('field-default')?.addEventListener('change', updateSelectedField);
    
    // Delete field button
    document.getElementById('delete-field')?.addEventListener('click', deleteSelectedField);
    
    // Form overlay for field placement and selection
    if (formOverlay) {
        formOverlay.addEventListener('click', handleOverlayClick);
        formOverlay.addEventListener('mousedown', handleOverlayMouseDown);
        formOverlay.addEventListener('mousemove', handleOverlayMouseMove);
        formOverlay.addEventListener('mouseup', handleOverlayMouseUp);
    }
    
    // Page number input in floating toolbar
    document.getElementById('page-number')?.addEventListener('change', (e) => {
        const newPage = parseInt(e.target.value);
        if (newPage && newPage > 0 && newPage <= totalPages) {
            currentPage = newPage;
            renderPage(currentPage);
        } else {
            e.target.value = currentPage;
        }
    });
}

/**
 * Load PDF from URL
 */
function loadPDF() {
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    
    // Get PDF URL from global variable or localStorage
    const pdfUrl = window.fileUrl || localStorage.getItem('pdfUrl');
    console.log('Loading PDF from URL:', pdfUrl);
    
    if (!pdfUrl) {
        showNotification('PDF URL not found. Please reload the page.', 'error');
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        return;
    }
    
    // Load PDF with PDF.js
    pdfjsLib.getDocument(pdfUrl)
        .promise
        .then(doc => {
            console.log('PDF loaded successfully');
            pdfDoc = doc;
            totalPages = doc.numPages;
            
            // Update page info in floating toolbar
            const pageNumberInput = document.getElementById('page-number');
            const pageCount = document.getElementById('page-count');
            
            if (pageNumberInput) pageNumberInput.value = currentPage;
            if (pageCount) pageCount.textContent = totalPages;
            
            // Render first page
            renderPage(currentPage);
            
            // Load existing form fields if available
            loadFormFields();
        })
        .catch(error => {
            console.error('Error loading PDF:', error);
            showNotification(`Error loading PDF: ${error.message}`, 'error');
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        });
}

/**
 * Render a specific page of the PDF
 */
function renderPage(pageNumber) {
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    
    pdfDoc.getPage(pageNumber).then(page => {
        pdfPage = page;
        
        const viewport = page.getViewport({ scale: currentScale });
        
        // Set canvas dimensions to match the PDF page at current scale
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        
        // Set container dimensions to match
        if (pdfContainer) {
            pdfContainer.style.width = `${viewport.width}px`;
            pdfContainer.style.height = `${viewport.height}px`;
        }
        
        // Set form overlay dimensions to match
        if (formOverlay) {
            formOverlay.style.width = `${viewport.width}px`;
            formOverlay.style.height = `${viewport.height}px`;
        }
        
        // Render the PDF page
        const renderContext = {
            canvasContext: pdfContext,
            viewport: viewport
        };
        
        page.render(renderContext).promise.then(() => {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            
            // Update page info in floating toolbar
            const pageNumberInput = document.getElementById('page-number');
            const pageCount = document.getElementById('page-count');
            
            if (pageNumberInput) pageNumberInput.value = pageNumber;
            if (pageCount) pageCount.textContent = totalPages;
            
            // Redraw form fields for this page
            renderFormFields(pageNumber);
        });
    });
}

/**
 * Load existing form fields from the server
 */
function loadFormFields() {
    const fileId = formData.fileId;
    if (!fileId) return;
    
    // Show loading notification
    showNotification('Loading form fields...', 'info');
    
    // Get loading indicator reference for error handling
    const loadingIndicator = document.getElementById('loading-indicator');
    
    // Make API request to get form schema
    // First try to get the design file which might contain schema information
    fetch(`/api/design/file/${fileId}`)
        .then(response => {
            if (!response.ok) {
                // If we get a 404, it might be a new form without any schema yet
                if (response.status === 404) {
                    console.log('No existing form schema found - starting with a blank form');
                    return { success: true, schema: { fields: [] } };
                }
                throw new Error(`HTTP error ${response.status}`);
            }
            
            // Check content type to handle potential PDF response instead of JSON
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/pdf')) {
                console.log('Received PDF instead of JSON, starting with blank form');
                return { success: true, schema: { fields: [] } };
            }
            
            // Safely try to parse JSON
            return response.json().catch(err => {
                console.warn('Error parsing JSON response:', err);
                return { success: true, schema: { fields: [] } };
            });
        })
        .then(data => {
            // Extract schema information from the response
            if (data.success && data.schema) {
                formData.schema = data.schema;
                formFields = data.schema.fields || [];
            } else if (data.form_metadata && typeof data.form_metadata === 'object') {
                // Try to use form_metadata if available
                try {
                    const schema = data.form_metadata;
                    formData.schema = schema;
                    formFields = schema.fields || [];
                } catch (e) {
                    console.warn('Could not parse form metadata:', e);
                    formFields = [];
                }
            } else {
                // Initialize with empty schema
                formFields = [];
            }
            
            // Render form fields
            renderFormFields(currentPage);
            
            showNotification('Form ready for editing', 'success');
        })
        .catch(error => {
            console.error('Error loading form fields:', error);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            // Don't show an error notification for JSON parsing issues
            // Just initialize with empty schema instead
            formFields = [];
            renderFormFields(currentPage);
        });
}

/**
 * Render form fields on the current page
 */
function renderFormFields(pageNumber) {
    // Clear existing form fields in the overlay
    if (formOverlay) {
        formOverlay.innerHTML = '';
        
        // Filter fields for the current page
        const fieldsOnPage = formFields.filter(field => field.page === pageNumber);
        
        // Create field elements
        fieldsOnPage.forEach(field => {
            const fieldElement = document.createElement('div');
            fieldElement.className = 'form-field';
            fieldElement.setAttribute('data-field-id', field.id);
            
            // Position and size the field
            fieldElement.style.position = 'absolute';
            fieldElement.style.left = `${field.x * currentScale}px`;
            fieldElement.style.top = `${field.y * currentScale}px`;
            fieldElement.style.width = `${field.width * currentScale}px`;
            fieldElement.style.height = `${field.height * currentScale}px`;
            
            // Style based on field type
            switch (field.type) {
                case 'text':
                    fieldElement.style.border = '1px solid #3498db';
                    fieldElement.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
                    break;
                case 'checkbox':
                    fieldElement.style.border = '1px solid #2ecc71';
                    fieldElement.style.backgroundColor = 'rgba(46, 204, 113, 0.1)';
                    break;
                case 'signature':
                    fieldElement.style.border = '1px solid #e74c3c';
                    fieldElement.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                    break;
                case 'number':
                    fieldElement.style.border = '1px solid #f39c12';
                    fieldElement.style.backgroundColor = 'rgba(243, 156, 18, 0.1)';
                    break;
                default:
                    fieldElement.style.border = '1px solid #95a5a6';
                    fieldElement.style.backgroundColor = 'rgba(149, 165, 166, 0.1)';
            }
            
            // Add label
            const label = document.createElement('div');
            label.className = 'field-label';
            label.style.fontSize = '12px';
            label.style.fontWeight = 'bold';
            label.style.padding = '2px 5px';
            label.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            label.style.position = 'absolute';
            label.style.top = '0';
            label.style.left = '0';
            label.style.maxWidth = '100%';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.textContent = field.name;
            
            fieldElement.appendChild(label);
            
            // Add field to overlay
            formOverlay.appendChild(fieldElement);
            
            // Add event listeners for selection and dragging
            fieldElement.addEventListener('click', (e) => {
                e.stopPropagation();
                selectField(field.id);
            });
        });
    }
}

/**
 * Select a field type to add to the form
 */
function selectFieldType(type) {
    console.log(`Selecting field type: ${type}`);
    
    // Reset any previously selected field type
    document.querySelectorAll('.form-field-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Exit placement mode if selecting the same type
    if (fieldTypeToAdd === type) {
        fieldTypeToAdd = null;
        isPlacingField = false;
        document.body.classList.remove('placing-field');
        document.getElementById('pdf-container').style.cursor = 'default';
        return;
    }
    
    // Set the field type to add
    fieldTypeToAdd = type;
    isPlacingField = true;
    
    // Add active class to button
    const button = document.querySelector(`.form-field-btn[data-type="${type}"]`);
    if (button) {
        button.classList.add('active');
    }
    
    // Change cursor to indicate placement mode
    document.body.classList.add('placing-field');
    document.getElementById('pdf-container').style.cursor = 'crosshair';
    
    // Show notification
    showNotification(`Click on the PDF to place ${fieldTypes[type]?.label || type} field`, 'info');
}

/**
 * Handle clicks on the PDF container when placing fields
 */
function handleOverlayClick(e) {
    if (!isPlacingField || !fieldTypeToAdd) return;
    
    // Get click coordinates relative to the PDF canvas
    const rect = e.target.getBoundingClientRect();
    const x = (e.clientX - rect.left) / currentScale;
    const y = (e.clientY - rect.top) / currentScale;
    
    console.log(`Adding ${fieldTypeToAdd} field at: ${x}, ${y}, page ${currentPage}`);
    
    // Add the field at the clicked position
    addFormField(fieldTypeToAdd, x, y, currentPage);
    
    // Exit placement mode
    fieldTypeToAdd = null;
    isPlacingField = false;
    document.body.classList.remove('placing-field');
    document.getElementById('pdf-container').style.cursor = 'default';
    document.querySelectorAll('.form-field-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Render page to show new field
    renderPage(currentPage);
}

/**
 * Update the PDF container to handle field placement clicks
 */
function setupPdfContainer() {
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer) {
        pdfContainer.addEventListener('click', handleOverlayClick);
    }
}

/* 
 * Duplicate functions removed:
 * - loadPDF()
 * - renderPage(pageNumber)
 * - loadFormFields()
 * - renderFormFields(pageNumber)
 * - selectField(fieldId)
 * 
 * These functions are already defined earlier in the file.
 */

/**
 * Update the field properties panel with active field data
 */
function updateFieldPropertiesPanel() {
    const nameInput = document.getElementById('fieldName');
    const requiredCheckbox = document.getElementById('required');
    const readonlyCheckbox = document.getElementById('readonly');
    
    if (activeField && nameInput && requiredCheckbox && readonlyCheckbox) {
        nameInput.value = activeField.name;
        requiredCheckbox.checked = activeField.required;
        readonlyCheckbox.checked = activeField.read_only;
    }
}

/**
 * Deselect the active field
 */
function deselectField() {
    // Remove selection from any selected field
    document.querySelectorAll('.form-field.selected').forEach(field => {
        field.classList.remove('selected');
    });
    
    // Hide field properties
    const propertiesForm = document.querySelector('.field-property-form');
    const noFieldMessage = document.querySelector('.no-field-selected');
    
    if (propertiesForm && noFieldMessage) {
        noFieldMessage.style.display = 'block';
        propertiesForm.style.display = 'none';
    }
    
    // Clear active field
    activeField = null;
}

/**
 * Select a form field by ID
 */
function selectField(fieldId) {
    // Deselect any previously selected field
    document.querySelectorAll('.form-field.selected').forEach(field => {
        field.classList.remove('selected');
    });
    
    // Find the field in our array
    const field = formFields.find(f => f.id === fieldId);
    if (!field) return;
    
    // Set the active field
    activeField = field;
    
    // Add selected class to the DOM element
    const fieldElement = document.querySelector(`.form-field[data-field-id="${fieldId}"]`);
    if (fieldElement) {
        fieldElement.classList.add('selected');
    }
    
    // Update the field properties panel
    updateFieldPropertiesPanel();
    
    // Show field properties form
    const propertiesForm = document.querySelector('.field-property-form');
    const noFieldMessage = document.querySelector('.no-field-selected');
    
    if (propertiesForm && noFieldMessage) {
        noFieldMessage.style.display = 'none';
        propertiesForm.style.display = 'block';
    }
}

/**
 * Update the selected field properties
 */
function updateSelectedField() {
    if (!activeField) return;
    
    const nameInput = document.getElementById('fieldName');
    const requiredCheckbox = document.getElementById('required');
    const readonlyCheckbox = document.getElementById('readonly');
    
    if (nameInput) {
        activeField.name = nameInput.value;
    }
    
    if (requiredCheckbox) {
        activeField.required = requiredCheckbox.checked;
    }
    
    if (readonlyCheckbox) {
        activeField.read_only = readonlyCheckbox.checked;
    }
    
    // Update field in array
    const index = formFields.findIndex(f => f.id === activeField.id);
    if (index !== -1) {
        formFields[index] = activeField;
    }
    
    // Re-render to show updates
    renderPage(currentPage);
}

/**
 * Delete the selected field
 */
function deleteSelectedField() {
    if (!activeField) return;
    
    // Remove from form fields array
    const fieldIndex = formFields.findIndex(field => field.id === activeField.id);
    if (fieldIndex !== -1) {
        formFields.splice(fieldIndex, 1);
    }
    
    // Update schema
    formData.schema.fields = formFields;
    
    // Re-render fields
    renderFormFields(currentPage);
    
    // Deselect field
    deselectField();
    
    showNotification('Field deleted', 'success');
}

/**
 * Save the form to the server
 */
function saveForm() {
    // Validate
    if (!formData.fileId) {
        showNotification('Missing file ID', 'error');
        return;
    }
    
    // Clean up fields for saving (remove temporary IDs, etc)
    const schemaToSave = {
        fields: formFields.map(field => {
            // Create a clean copy of the field
            return {
                name: field.name,
                type: field.type,
                x: field.x,
                y: field.y,
                width: field.width,
                height: field.height,
                page: field.page,
                required: field.required,
                default_value: field.default_value
            };
        })
    };
    
    // Show saving notification
    showNotification('Saving form...', 'info');
    
    // Send to server
    fetch('/api/save-form-schema', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            file_id: formData.fileId,
            schema: schemaToSave
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showNotification('Form saved successfully', 'success');
            
            // Store created file ID for later use
            if (data.created_file_id) {
                localStorage.setItem('createdFileId', data.created_file_id);
            }
            
            // Store portfolio ID for later use
            if (data.portfolio_id) {
                localStorage.setItem('portfolioId', data.portfolio_id);
            }
        } else {
            showNotification(`Error: ${data.error || 'Unknown error'}`, 'error');
        }
    })
    .catch(error => {
        console.error('Error saving form:', error);
        showNotification(`Error saving form: ${error.message}`, 'error');
    });
}

/**
 * Show the save modal dialog
 */
function showSaveModal() {
    const modal = document.getElementById('save-modal');
    if (modal) {
        // Set default filename based on original file
        const filenameInput = document.getElementById('save-filename');
        if (filenameInput) {
            const originalFilename = document.title.replace('PDF Editor - ', '').replace('.pdf', '');
            filenameInput.value = `${originalFilename} - Form.pdf`;
        }
        
        modal.style.display = 'flex';
    }
}

/**
 * Hide the save modal dialog
 */
function hideSaveModal() {
    const modal = document.getElementById('save-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Show a notification to the user
 */
function showNotification(message, type = 'info', duration = 5000) {
    // Use global showNotification function if available
    if (typeof window.showNotification === 'function') {
        return window.showNotification(message, type, duration);
    }
    
    // Fallback implementation
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close">&times;</button>
    `;
    
    container.appendChild(notification);
    
    // Add animation
    setTimeout(() => notification.classList.add('active'), 10);
    
    // Remove after duration
    const timeout = setTimeout(() => {
        notification.classList.remove('active');
        setTimeout(() => notification.remove(), 300);
    }, duration);
    
    // Add close button handler
    const closeBtn = notification.querySelector('.notification-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            clearTimeout(timeout);
            notification.classList.remove('active');
            setTimeout(() => notification.remove(), 300);
        });
    }
    
    return notification;
}

/**
 * Handle overlay mousedown for drag operations
 */
function handleOverlayMouseDown(e) {
    // Check if we clicked on a form field
    if (e.target.classList.contains('form-field') || e.target.closest('.form-field')) {
        const field = e.target.classList.contains('form-field') ? e.target : e.target.closest('.form-field');
        const fieldId = field.getAttribute('data-field-id');
        
        // Select the field
        selectField(fieldId);
        
        // Start dragging
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        e.preventDefault();
        e.stopPropagation();
    } else {
        // If clicking on empty space, deselect field
        deselectField();
    }
}

/**
 * Handle overlay mousemove for drag operations
 */
function handleOverlayMouseMove(e) {
    if (!isDragging || !activeField) return;
    
    // Calculate the drag distance
    const deltaX = (e.clientX - startX) / currentScale;
    const deltaY = (e.clientY - startY) / currentScale;
    
    // Update the active field position
    activeField.x += deltaX;
    activeField.y += deltaY;
    
    // Update the starting position for the next move
    startX = e.clientX;
    startY = e.clientY;
    
    // Rerender the form fields
    renderFormFields(currentPage);
    
    e.preventDefault();
}

/**
 * Handle overlay mouseup to end drag operations
 */
function handleOverlayMouseUp(e) {
    if (isDragging) {
        isDragging = false;
        e.preventDefault();
        e.stopPropagation();
    }
}

/**
 * Add a new form field to the form
 */
function addFormField(type, x, y, page) {
    // Generate a unique ID for the field
    const fieldId = `field_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Default field properties
    const defaultWidth = fieldTypes[type]?.defaultWidth || 200;
    const defaultHeight = fieldTypes[type]?.defaultHeight || 40;
    
    // Create new field object
    const field = {
        id: fieldId,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)}_${formFields.length + 1}`,
        type: type,
        x: x,
        y: y,
        width: defaultWidth,
        height: defaultHeight,
        page: page,
        required: false,
        read_only: false,
        default_value: ''
    };
    
    // Add field to form fields array
    formFields.push(field);
    
    // Update schema
    formData.schema.fields = formFields;
    
    // Select the new field
    activeField = field;
    
    // Show notification
    showNotification(`Added ${type} field`, 'success');
    
    // Rerender fields
    renderFormFields(page);
    
    // Update field properties panel
    updateFieldPropertiesPanel();
    
    return fieldId;
}
