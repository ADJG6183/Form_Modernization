/**
 * Edit Page JavaScript for PDF Portfolio approach
 * 
 * This script handles:
 * - Loading a surface PDF with AcroForm fields
 * - Overlaying HTML input elements at field coordinates
 * - Collecting values on save and updating the PDF
 */

// Global variables - prefix with portfolio_ to avoid conflicts
const portfolioEditor = {
    pdfDoc: null,
    pdfCanvas: null,
    pdfContext: null,
    currentPage: 1,
    totalPages: 0,
    currentScale: 1.0,
    formFields: [],
    fieldInputs: {},
    activeField: null,
    formData: {
        fileId: null,
        portfolioId: null,
        filledFormId: null,
        editingExistingForm: false
    }
};

// DOM Elements (initialized after document loads)
portfolioEditor.elements = {
    pdfContainer: null,
    fieldsList: null,
    propertiesPanel: null
};

// Initialize the application when DOM is ready - only if we're on the edit page
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if we're on the edit page and the body has a data-file-id
    if (document.body.getAttribute('data-file-id')) {
        portfolioEditor.initializeUI();
        portfolioEditor.bindEventListeners();
        portfolioEditor.loadPDF();
    }
});

/**
 * Initialize UI elements
 */
portfolioEditor.initializeUI = function() {
    // Get file ID from DOM
    const fileId = document.body.getAttribute('data-file-id');
    portfolioEditor.formData.fileId = fileId;
    
    // Get portfolioId from window.APP (template data) or localStorage (from saved_files.html)
    portfolioEditor.formData.portfolioId = (window.APP && window.APP.portfolioId) || localStorage.getItem('portfolioId');
    console.log('Using portfolio ID:', portfolioEditor.formData.portfolioId);
    
    portfolioEditor.formData.filledFormId = localStorage.getItem('filledFormId');
    portfolioEditor.formData.editingExistingForm = window.APP && window.APP.editingFilledForm;
    
    // Initialize UI references
    portfolioEditor.elements.pdfContainer = document.querySelector('.pdf-viewer-container');
    portfolioEditor.elements.fieldsList = document.querySelector('.fields-panel');
    portfolioEditor.elements.propertiesPanel = document.querySelector('.properties-panel');
    
    // Create PDF viewer in the container
    if (portfolioEditor.elements.pdfContainer) {
        portfolioEditor.elements.pdfContainer.innerHTML = `
            <div class="pdf-controls">
                <div class="page-controls">
                    <button id="portfolio-prev-page" class="button button-icon" title="Previous Page">
                        <i class="material-icons">navigate_before</i>
                    </button>
                    <span id="portfolio-page-info">Page 1 of 1</span>
                    <button id="portfolio-next-page" class="button button-icon" title="Next Page">
                        <i class="material-icons">navigate_next</i>
                    </button>
                </div>
                <div class="zoom-controls">
                    <button id="portfolio-zoom-out" class="button button-icon" title="Zoom Out">
                        <i class="material-icons">zoom_out</i>
                    </button>
                    <span id="portfolio-zoom-level">100%</span>
                    <button id="portfolio-zoom-in" class="button button-icon" title="Zoom In">
                        <i class="material-icons">zoom_in</i>
                    </button>
                </div>
            </div>
            <div class="pdf-viewer">
                <canvas id="portfolio-pdf-canvas"></canvas>
                <div id="portfolio-form-overlay" class="form-overlay"></div>
                <div id="portfolio-loading-indicator" class="loading-indicator">Loading PDF...</div>
            </div>
        `;
    }
    
    // Initialize fields panel
    if (portfolioEditor.elements.fieldsList) {
        portfolioEditor.elements.fieldsList.innerHTML = `
            <div class="panel-header">
                <h2>Form Fields</h2>
            </div>
            <div class="fields-list" id="fields-list">
                <div class="loading">Loading fields...</div>
            </div>
        `;
    }
    
    // Initialize properties panel
    if (portfolioEditor.elements.propertiesPanel) {
        portfolioEditor.elements.propertiesPanel.innerHTML = `
            <div class="panel-header">
                <h2>Field Properties</h2>
            </div>
            <div id="field-properties" class="field-properties">
                <p class="no-field-selected">Select a field to edit its properties</p>
                <div class="field-property-form" style="display: none;">
                    <!-- Field properties will be loaded dynamically -->
                </div>
            </div>
        `;
    }
    
    // Initialize save button
    const saveBtn = document.querySelector('.actions');
    if (saveBtn) {
        if (!saveBtn.querySelector('#save-btn')) {
            saveBtn.innerHTML = `
                <button id="save-btn" class="button button-primary">
                    <i class="material-icons">save</i> ${portfolioEditor.formData.editingExistingForm ? 'Update' : 'Save'} Form
                </button>
            `;
        }
    }
    
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
portfolioEditor.bindEventListeners = function() {
    // Page navigation
    document.getElementById('portfolio-prev-page')?.addEventListener('click', () => {
        if (portfolioEditor.currentPage > 1) {
            portfolioEditor.currentPage--;
            portfolioEditor.renderPage(portfolioEditor.currentPage);
        }
    });
    
    document.getElementById('portfolio-next-page')?.addEventListener('click', () => {
        if (portfolioEditor.currentPage < portfolioEditor.totalPages) {
            portfolioEditor.currentPage++;
            portfolioEditor.renderPage(portfolioEditor.currentPage);
        }
    });
    
    // Zoom controls
    document.getElementById('portfolio-zoom-in')?.addEventListener('click', () => {
        portfolioEditor.currentScale += 0.1;
        portfolioEditor.renderPage(portfolioEditor.currentPage);
        document.getElementById('portfolio-zoom-level').textContent = `${Math.round(portfolioEditor.currentScale * 100)}%`;
    });
    
    document.getElementById('portfolio-zoom-out')?.addEventListener('click', () => {
        if (portfolioEditor.currentScale > 0.2) {
            portfolioEditor.currentScale -= 0.1;
            portfolioEditor.renderPage(portfolioEditor.currentPage);
            document.getElementById('portfolio-zoom-level').textContent = `${Math.round(portfolioEditor.currentScale * 100)}%`;
        }
    });
    
    // Save button
    document.getElementById('save-btn')?.addEventListener('click', () => {
        portfolioEditor.showSaveModal();
    });
    
    // Debug button
    document.getElementById('debug-btn')?.addEventListener('click', () => {
        if (typeof portfolioEditor.openDebugModal === 'function') {
            portfolioEditor.openDebugModal();
        } else {
            // Fallback if debug modal function not defined
            document.getElementById('debug-modal').style.display = 'flex';
        }
    });
    
    // Modal buttons
    document.getElementById('confirm-save')?.addEventListener('click', portfolioEditor.saveFilledForm);
    document.getElementById('cancel-save')?.addEventListener('click', () => {
        document.getElementById('save-modal').style.display = 'none';
    });
}

/**
 * Report PDF loading errors to the server for debugging
 */
portfolioEditor.reportPDFError = function(error, portfolioId, url, details = {}) {
    console.log('Reporting PDF error to server:', error.message);
    
    // Use the standalone PDF error reporter if available
    if (window.pdfErrorReporter && window.pdfErrorReporter.reportPDFError) {
        return window.pdfErrorReporter.reportPDFError(error, portfolioId, url, {
            ...details,
            fileId: portfolioEditor.formData.fileId,
            currentPage: portfolioEditor.currentPage
        });
    }
    
    // Fallback: Send error to server if legacy error reporting API is available
    if (window.PDFErrorReporter && window.PDFErrorReporter.reportError) {
        window.PDFErrorReporter.reportError({
            type: 'pdf_loading_error',
            message: error.message,
            stack: error.stack,
            portfolioId: portfolioId,
            url: url,
            details: JSON.stringify({
                ...details,
                fileId: portfolioEditor.formData.fileId,
                currentPage: portfolioEditor.currentPage,
                browser: navigator.userAgent
            })
        });
    }
    
    // Show error in the debug modal if available
    const debugModal = document.getElementById('debug-modal');
    if (debugModal) {
        const debugContent = debugModal.querySelector('.debug-content') || debugModal;
        
        // Clear previous content
        if (debugContent.innerHTML) {
            debugContent.innerHTML = '';
        }
        
        // Add error info
        const errorInfo = document.createElement('div');
        errorInfo.className = 'error-info';
        
        // Format the error details
        errorInfo.innerHTML = `
            <h3>PDF Loading Error</h3>
            <p><strong>Error:</strong> ${error.message}</p>
            <p><strong>Portfolio ID:</strong> ${portfolioId || 'Not set'}</p>
            <p><strong>File ID:</strong> ${portfolioEditor.formData.fileId || 'Not set'}</p>
            <p><strong>URL:</strong> ${url || 'Not set'}</p>
            <pre>${error.stack || 'No stack trace available'}</pre>
            <hr>
            <h4>Additional Details:</h4>
            <pre>${JSON.stringify(details, null, 2)}</pre>
        `;
        
        debugContent.appendChild(errorInfo);
        
        // Add show debug modal button to the error notification
        const showDebugButton = document.createElement('button');
        showDebugButton.textContent = 'Show Debug Info';
        showDebugButton.className = 'button button-secondary';
        showDebugButton.style.marginLeft = '10px';
        showDebugButton.addEventListener('click', () => {
            debugModal.style.display = 'flex';
        });
        
        // Find the notification element and append the button
        const notificationElem = document.querySelector('.notification');
        if (notificationElem) {
            notificationElem.appendChild(showDebugButton);
        }
    }
    
    // Display user-friendly error in the loading indicator
    const loadingIndicator = document.getElementById('portfolio-loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.innerHTML = `
            <div class="error-container">
                <h3>Error Loading PDF</h3>
                <p>${error.message}</p>
                <button id="retry-load-pdf" class="button button-primary">Retry</button>
                <button id="show-debug-info" class="button button-secondary">Debug Info</button>
            </div>
        `;
        
        // Add retry button listener
        document.getElementById('retry-load-pdf')?.addEventListener('click', () => {
            loadingIndicator.innerHTML = 'Retrying...';
            setTimeout(() => portfolioEditor.loadPDF(), 500);
        });
        
        // Add debug button listener
        document.getElementById('show-debug-info')?.addEventListener('click', () => {
            const debugModal = document.getElementById('debug-modal');
            if (debugModal) {
                debugModal.style.display = 'flex';
            } else {
                alert('Debug information: ' + error.message);
            }
        });
    }
}

/**
 * Load PDF from URL
 */
portfolioEditor.loadPDF = function() {
    console.log('Loading PDF...');
    
    const loadingIndicator = document.getElementById('portfolio-loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.style.display = 'flex';
        loadingIndicator.innerHTML = 'Loading PDF...';
    }
    
    // Get URL to the PDF with better prioritization and error handling
    let pdfUrl = null;
    let urlSource = 'unknown';
    
    // Determine URL source with clear priority order
    const portfolioId = portfolioEditor.formData.portfolioId;
    const fileId = portfolioEditor.formData.fileId;
    
    // Priority 1: Portfolio ID (preferred for surface files)
    if (portfolioId) {
        pdfUrl = `/api/portfolio/${portfolioId}/surface-file`;
        urlSource = 'portfolio_api';
    } 
    // Priority 2: APP context from server
    else if (window.APP && window.APP.fileUrl) {
        pdfUrl = window.APP.fileUrl;
        urlSource = 'app_context';
    } 
    // Priority 3: Local storage (for returning to an edit session)
    else if (localStorage.getItem('pdfUrl')) {
        pdfUrl = localStorage.getItem('pdfUrl');
        urlSource = 'local_storage';
    }
    // Priority 4: Direct file access
    else if (fileId) {
        pdfUrl = `/serve-pdf/${fileId}`;
        urlSource = 'direct_file';
    }
    
    console.log(`Loading PDF from URL (${urlSource}):`, pdfUrl);
    
    // Validate we have a URL
    if (!pdfUrl) {
        const errorDetails = {
            portfolioId,
            fileId,
            hasAppContext: !!window.APP,
            hasLocalStorage: !!localStorage.getItem('pdfUrl')
        };
        
        const error = new Error('PDF URL not found. Missing portfolio ID and file ID.');
        
        // Use standalone notification if available, otherwise use the portfolioEditor one
        if (window.pdfErrorReporter && window.pdfErrorReporter.showNotification) {
            window.pdfErrorReporter.showNotification('Error: Could not determine PDF URL', 'error');
        } else {
            portfolioEditor.showNotification('Error: Could not determine PDF URL', 'error');
        }
        
        // Use standalone error reporter if available
        if (window.pdfErrorReporter && window.pdfErrorReporter.reportPDFError) {
            window.pdfErrorReporter.reportPDFError(error, portfolioId, null, {
                ...errorDetails,
                fileId: portfolioEditor.formData.fileId,
                currentPage: portfolioEditor.currentPage
            });
        } else {
            portfolioEditor.reportPDFError(error, portfolioId, null, errorDetails);
        }
        return;
    }
    
    // Initialize PDF canvas
    portfolioEditor.pdfCanvas = document.getElementById('portfolio-pdf-canvas');
    portfolioEditor.pdfContext = portfolioEditor.pdfCanvas.getContext('2d');
    
    // First check if the URL is accessible with improved error handling
    fetch(pdfUrl)
        .then(response => {
            console.log('URL fetch response:', response.status, response.statusText);
            
            if (!response.ok) {
                const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
                const error = new Error(errorMsg);
                
                // Add response status details for better error handling
                error.httpStatus = response.status;
                error.httpStatusText = response.statusText;
                throw error;
            }
            
            // Check if response is actually a PDF (not an error page or HTML)
            const contentType = response.headers.get('content-type');
            console.log('Content-Type:', contentType);
            
            if (!contentType || !contentType.includes('application/pdf')) {
                console.warn('Response might not be a PDF. Content-Type:', contentType);
                
                // Try to get the response text to see what came back
                return response.text().then(text => {
                    if (text.includes('<!DOCTYPE html>') || text.includes('<html>')) {
                        console.error('Received HTML instead of PDF');
                        const error = new Error('Server returned HTML instead of a PDF. You might need to log in again.');
                        error.responseType = 'html';
                        error.responsePreview = text.substring(0, 500);
                        throw error;
                    }
                    
                    // Continue with PDF.js loading despite content-type mismatch
                    // Some servers might not set the correct content type
                    console.log('Continuing with PDF.js loading despite content-type mismatch');
                    portfolioEditor.showNotification('Loading PDF document...', 'info');
                    return pdfjsLib.getDocument({
                        url: pdfUrl,
                        withCredentials: true
                    }).promise;
                });
            }
            
            // Continue with PDF.js loading
            console.log('URL is accessible, loading PDF with PDF.js');
            portfolioEditor.showNotification('Loading PDF document...', 'info');
            return pdfjsLib.getDocument({
                url: pdfUrl,
                withCredentials: true
            }).promise;
        })
        .then(doc => {
            console.log('PDF loaded successfully with pages:', doc.numPages);
            portfolioEditor.pdfDoc = doc;
            portfolioEditor.totalPages = doc.numPages;
            
            // Save URL in localStorage for potential refresh
            localStorage.setItem('pdfUrl', pdfUrl);
            
            // Update page info
            const pageInfo = document.getElementById('portfolio-page-info');
            if (pageInfo) {
                pageInfo.textContent = `Page ${portfolioEditor.currentPage} of ${portfolioEditor.totalPages}`;
            }
            
            // Hide loading indicator
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            
            // Render first page
            portfolioEditor.renderPage(portfolioEditor.currentPage);
            
            // Load form fields
            portfolioEditor.loadFormFields();
        })
        .catch(error => {
            console.error('Error loading PDF:', error);
            
            // Enhanced error reporting with user-friendly messages
            let errorMsg = error.message;
            let errorType = 'generic';
            
            // Categorize error for better user messaging
            if (error.httpStatus === 404 || error.message.includes('404') || error.message.includes('Not Found')) {
                errorMsg = `PDF file not found. ${portfolioId ? `Portfolio ID: ${portfolioId}` : `File ID: ${fileId}`}`;
                errorType = 'not_found';
            } else if (error.httpStatus === 401 || error.httpStatus === 403 || 
                      error.message.includes('401') || error.message.includes('403')) {
                errorMsg = 'Access denied. Please refresh the page and log in again.';
                errorType = 'access_denied';
            } else if (error.message.includes('CORS') || error.message.includes('NetworkError')) {
                errorMsg = 'Network error loading the PDF. Please check your connection and try again.';
                errorType = 'network';
            } else if (error.responseType === 'html') {
                errorMsg = 'The server returned HTML instead of a PDF. You may need to log in again.';
                errorType = 'html_response';
            } else if (error.message.includes('PDF.js')) {
                errorMsg = 'Error parsing the PDF file. The file may be corrupted.';
                errorType = 'pdf_parse';
            }
            
            // Use standalone notification if available, otherwise use the portfolioEditor one
            if (window.pdfErrorReporter && window.pdfErrorReporter.showNotification) {
                window.pdfErrorReporter.showNotification(errorMsg, 'error');
            } else {
                portfolioEditor.showNotification(errorMsg, 'error');
            }
            
            // Report detailed error info - use standalone reporter if available
            if (window.pdfErrorReporter && window.pdfErrorReporter.reportPDFError) {
                window.pdfErrorReporter.reportPDFError(error, portfolioId, pdfUrl, {
                    errorType,
                    urlSource,
                    responseType: error.responseType,
                    httpStatus: error.httpStatus,
                    responsePreview: error.responsePreview,
                    fileId: portfolioEditor.formData.fileId,
                    currentPage: portfolioEditor.currentPage
                });
            } else {
                portfolioEditor.reportPDFError(error, portfolioId, pdfUrl, {
                    errorType,
                    urlSource,
                    responseType: error.responseType,
                    httpStatus: error.httpStatus,
                    responsePreview: error.responsePreview
                });
            }
        });
}

/**
 * Render a specific page of the PDF
 */
portfolioEditor.renderPage = function(pageNumber) {
    const loadingIndicator = document.getElementById('portfolio-loading-indicator');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    
    // Validate parameters and state
    if (!pageNumber || pageNumber < 1) {
        console.warn('Invalid page number, defaulting to page 1');
        pageNumber = 1;
    }
    
    // Check if PDF document is loaded
    if (!portfolioEditor.pdfDoc) {
        console.error('PDF document not loaded. Cannot render page.');
        portfolioEditor.showNotification('Error: PDF document not loaded. Please try reloading the page.', 'error');
        if (loadingIndicator) {
            loadingIndicator.innerHTML = `
                <div class="error-container">
                    <p>PDF document not loaded</p>
                    <button id="retry-pdf-load" class="button button-primary">Retry Loading</button>
                </div>
            `;
            
            // Add retry button event listener
            document.getElementById('retry-pdf-load')?.addEventListener('click', () => {
                loadingIndicator.innerHTML = 'Retrying...';
                setTimeout(() => portfolioEditor.loadPDF(), 500);
            });
        }
        return;
    }
    
    // Check if page number is in range
    if (pageNumber > portfolioEditor.totalPages) {
        console.warn(`Page ${pageNumber} exceeds total pages (${portfolioEditor.totalPages}), showing last page`);
        pageNumber = portfolioEditor.totalPages;
        portfolioEditor.currentPage = pageNumber;
    }
    
    // Update current page
    portfolioEditor.currentPage = pageNumber;
    
    try {
        // Get the page with error handling
        portfolioEditor.pdfDoc.getPage(pageNumber)
            .then(page => {
                const viewport = page.getViewport({ scale: portfolioEditor.currentScale });
                
                // Set canvas dimensions to match the PDF page at current scale
                portfolioEditor.pdfCanvas.width = viewport.width;
                portfolioEditor.pdfCanvas.height = viewport.height;
                
                // Create parent wrapper element with proper dimensions if it doesn't exist
                const overlay = document.getElementById('portfolio-form-overlay');
                if (overlay) {
                    overlay.style.width = `${viewport.width}px`;
                    overlay.style.height = `${viewport.height}px`;
                }
                
                // Render the PDF page with error handling
                const renderContext = {
                    canvasContext: portfolioEditor.pdfContext,
                    viewport: viewport
                };
                
                return page.render(renderContext).promise
                    .then(() => {
                        if (loadingIndicator) loadingIndicator.style.display = 'none';
                        
                        // Update page info
                        const pageInfo = document.getElementById('portfolio-page-info');
                        if (pageInfo) {
                            pageInfo.textContent = `Page ${pageNumber} of ${portfolioEditor.totalPages}`;
                        }
                        
                        // Position the form fields overlay after page is rendered
                        portfolioEditor.positionFormFieldsOverlay();
                    })
                    .catch(error => {
                        console.error('Error rendering PDF page:', error);
                        
                        // Use standalone notification if available, otherwise use the portfolioEditor one
                        if (window.pdfErrorReporter && window.pdfErrorReporter.showNotification) {
                            window.pdfErrorReporter.showNotification('Error rendering PDF page: ' + error.message, 'error');
                        } else {
                            portfolioEditor.showNotification('Error rendering PDF page: ' + error.message, 'error');
                        }
                        if (loadingIndicator) loadingIndicator.style.display = 'none';
                    });
            })
            .catch(error => {
                console.error('Error getting PDF page:', error);
                
                // Use standalone notification if available, otherwise use the portfolioEditor one
                if (window.pdfErrorReporter && window.pdfErrorReporter.showNotification) {
                    window.pdfErrorReporter.showNotification('Error getting PDF page: ' + error.message, 'error');
                } else {
                    portfolioEditor.showNotification('Error getting PDF page: ' + error.message, 'error');
                }
                
                if (loadingIndicator) loadingIndicator.style.display = 'none';
            });
    } catch (error) {
        console.error('Unexpected error rendering page:', error);
        
        // Use standalone notification if available, otherwise use the portfolioEditor one
        if (window.pdfErrorReporter && window.pdfErrorReporter.showNotification) {
            window.pdfErrorReporter.showNotification('Unexpected error rendering page: ' + error.message, 'error');
        } else {
            portfolioEditor.showNotification('Unexpected error rendering page: ' + error.message, 'error');
        }
        
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
    
    // Overlay form fields for this page
    portfolioEditor.overlayFormFields(pageNumber);
}

/**
 * Position the form fields overlay relative to the PDF canvas
 * This ensures fields appear at the correct location regardless of zoom
 */
portfolioEditor.positionFormFieldsOverlay = function() {
    const overlay = document.getElementById('portfolio-form-overlay');
    const canvas = portfolioEditor.pdfCanvas;
    
    if (!overlay || !canvas) return;
    
    // Match overlay size and position to canvas
    overlay.style.width = `${canvas.width}px`;
    overlay.style.height = `${canvas.height}px`;
    
    // Position fields based on current scale
    for (const fieldName in portfolioEditor.fieldInputs) {
        const input = portfolioEditor.fieldInputs[fieldName];
        const fieldData = portfolioEditor.formFields.find(f => f.name === fieldName);
        
        if (input && fieldData && fieldData.page === portfolioEditor.currentPage - 1) {
            // Calculate positions based on current scale
            const scaledX = fieldData.x * portfolioEditor.currentScale;
            const scaledY = fieldData.y * portfolioEditor.currentScale;
            const scaledWidth = fieldData.width * portfolioEditor.currentScale;
            const scaledHeight = fieldData.height * portfolioEditor.currentScale;
            
            // Set position
            input.style.left = `${scaledX}px`;
            input.style.top = `${scaledY}px`;
            input.style.width = `${scaledWidth}px`;
            input.style.height = `${scaledHeight}px`;
            
            // Show field if it's on the current page
            input.style.display = 'block';
        } else if (input) {
            // Hide field if it's not on the current page
            input.style.display = 'none';
        }
    }
}

/**
 * Load form fields from the server
 */
portfolioEditor.loadFormFields = function() {
    const fileId = portfolioEditor.formData.fileId;
    if (!fileId) return;
    
    // Show loading notification
    portfolioEditor.showNotification('Loading form fields...', 'info');
    
    // Make API request to get form schema
    fetch(`/api/get-form-schema/${fileId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.schema) {
                portfolioEditor.formFields = data.schema.fields || [];
                
                // Log field count for debugging
                console.log(`Loaded ${portfolioEditor.formFields.length} form fields`);
                
                if (portfolioEditor.formFields.length === 0) {
                    console.warn('No form fields found in schema');
                    portfolioEditor.showNotification('No form fields found in this template. You may need to design this form first.', 'warning');
                } else {
                    // Generate field list
                    portfolioEditor.generateFieldsList();
                    
                    // Overlay form fields on the PDF
                    portfolioEditor.overlayFormFields(portfolioEditor.currentPage);
                    
                    // Check if we should load existing form data
                    if (portfolioEditor.formData.editingExistingForm && window.APP?.filledFormData) {
                        portfolioEditor.loadExistingFormData(window.APP.filledFormData);
                    }
                    
                    portfolioEditor.showNotification('Form fields loaded successfully', 'success');
                }
            } else {
                portfolioEditor.showNotification('No form fields found', 'warning');
            }
        })
        .catch(error => {
            console.error('Error loading form fields:', error);
            portfolioEditor.showNotification(`Error loading form fields: ${error.message}`, 'error');
        });
}

/**
 * Load existing form data for editing
 */
portfolioEditor.loadExistingFormData = function(formDataJson) {
    try {
        const existingData = typeof formDataJson === 'string' 
            ? JSON.parse(formDataJson) 
            : formDataJson;
        
        // Set values in field inputs
        Object.keys(existingData).forEach(fieldName => {
            const input = portfolioEditor.fieldInputs[fieldName];
            if (input) {
                if (input.type === 'checkbox') {
                    input.checked = existingData[fieldName] === 'true' || existingData[fieldName] === true;
                } else {
                    input.value = existingData[fieldName];
                }
                
                // Trigger change event to update any UI elements
                const event = new Event('change');
                input.dispatchEvent(event);
            }
        });
        
        portfolioEditor.showNotification('Loaded existing form data', 'success');
    } catch (error) {
        console.error('Error parsing existing form data:', error);
        portfolioEditor.showNotification('Error loading existing form data', 'error');
    }
}

/**
 * Generate list of fields in the left panel
 */
portfolioEditor.generateFieldsList = function() {
    const fieldsList = document.getElementById('fields-list');
    if (!fieldsList) return;
    
    // Clear existing content
    fieldsList.innerHTML = '';
    
    // Check if we have fields
    if (portfolioEditor.formFields.length === 0) {
        fieldsList.innerHTML = '<div class="empty-fields">No fields found in this form</div>';
        return;
    }
    
    // Group fields by page
    const fieldsByPage = {};
    portfolioEditor.formFields.forEach(field => {
        const page = field.page || 0;
        if (!fieldsByPage[page]) fieldsByPage[page] = [];
        fieldsByPage[page].push(field);
    });
    
    // Create field list with page sections
    Object.keys(fieldsByPage).sort((a, b) => parseInt(a) - parseInt(b)).forEach(page => {
        // Create page section
        const pageSection = document.createElement('div');
        pageSection.className = 'page-section';
        pageSection.innerHTML = `<h3>Page ${parseInt(page) + 1}</h3>`;
        
        // Add fields for this page
        const fieldsInPage = fieldsByPage[page];
        fieldsInPage.forEach(field => {
            const fieldItem = document.createElement('div');
            fieldItem.className = 'field-item';
            fieldItem.setAttribute('data-field-name', field.name);
            fieldItem.innerHTML = `
                <div class="field-icon">
                    <i class="material-icons">${portfolioEditor.getFieldIcon(field.type)}</i>
                </div>
                <div class="field-info">
                    <div class="field-name">${field.name}</div>
                    <div class="field-type">${portfolioEditor.capitalizeFirstLetter(field.type)}</div>
                </div>
            `;
            
            // Add click handler to jump to field
            fieldItem.addEventListener('click', () => {
                // Change to the field's page if needed
                if (portfolioEditor.currentPage !== parseInt(page) + 1) {
                    portfolioEditor.currentPage = parseInt(page) + 1;
                    portfolioEditor.renderPage(portfolioEditor.currentPage);
                }
                
                // Focus the field input
                setTimeout(() => {
                    const input = portfolioEditor.fieldInputs[field.name];
                    if (input) {
                        input.focus();
                        portfolioEditor.selectField(field.name);
                    }
                }, 100);
            });
            
            pageSection.appendChild(fieldItem);
        });
        
        fieldsList.appendChild(pageSection);
    });
}

/**
 * Overlay form fields on the PDF canvas
 */
portfolioEditor.overlayFormFields = function(pageNumber) {
    const formOverlay = document.getElementById('portfolio-form-overlay');
    if (!formOverlay) return;
    
    // Clear existing fields
    formOverlay.innerHTML = '';
    
    // Filter fields for current page
    const fieldsOnPage = portfolioEditor.formFields.filter(field => field.page === pageNumber - 1);
    
    // Reset field inputs for this page
    fieldsOnPage.forEach(field => {
        if (portfolioEditor.fieldInputs[field.name]) {
            delete portfolioEditor.fieldInputs[field.name];
        }
    });
    
    // Overlay each field with an HTML input element
    fieldsOnPage.forEach(field => {
        // Create field container
        const fieldContainer = document.createElement('div');
        fieldContainer.className = `form-field form-field-${field.type}`;
        fieldContainer.setAttribute('data-field-name', field.name);
        
        // Position the field
        fieldContainer.style.position = 'absolute';
        fieldContainer.style.left = `${field.x * portfolioEditor.currentScale}px`;
        fieldContainer.style.top = `${field.y * portfolioEditor.currentScale}px`;
        fieldContainer.style.width = `${field.width * portfolioEditor.currentScale}px`;
        fieldContainer.style.height = `${field.height * portfolioEditor.currentScale}px`;
        
        // Create input element based on field type
        let inputElement;
        
        switch (field.type) {
            case 'checkbox':
                inputElement = document.createElement('input');
                inputElement.type = 'checkbox';
                inputElement.className = 'field-input checkbox-input';
                break;
                
            case 'signature':
                // Create a signature pad container
                inputElement = document.createElement('div');
                inputElement.className = 'signature-pad-container';
                
                // Add canvas for signature
                const canvas = document.createElement('canvas');
                canvas.className = 'signature-pad';
                canvas.width = field.width * portfolioEditor.currentScale;
                canvas.height = field.height * portfolioEditor.currentScale;
                
                // Add clear button
                const clearBtn = document.createElement('button');
                clearBtn.className = 'signature-clear-btn';
                clearBtn.innerHTML = 'Clear';
                
                // Add to container
                inputElement.appendChild(canvas);
                inputElement.appendChild(clearBtn);
                
                // Initialize signature pad after adding to DOM
                setTimeout(() => {
                    const signaturePad = new SignaturePad(canvas);
                    
                    // Store signature pad instance
                    portfolioEditor.fieldInputs[field.name] = {
                        type: 'signature',
                        pad: signaturePad,
                        value: '',
                        setValue: (val) => {
                            if (val) signaturePad.fromDataURL(val);
                        },
                        getValue: () => signaturePad.toDataURL()
                    };
                    
                    // Add clear button handler
                    clearBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        signaturePad.clear();
                    });
                }, 100);
                break;
                
            case 'date':
                inputElement = document.createElement('input');
                inputElement.type = 'date';
                inputElement.className = 'field-input date-input';
                break;
                
            default: // text field
                inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.className = 'field-input text-input';
                
                // Add placeholder
                inputElement.placeholder = field.name;
        }
        
        // If standard input element, store it and set common properties
        if (inputElement.tagName === 'INPUT') {
            portfolioEditor.fieldInputs[field.name] = inputElement;
            
            // Set name and default value
            inputElement.name = field.name;
            inputElement.value = field.default_value || '';
            
            // Add required attribute if needed
            if (field.required) {
                inputElement.setAttribute('required', 'required');
            }
            
            // Add change handler
            inputElement.addEventListener('change', () => {
                // Update global form data
                if (window.APP && window.APP.jsonFormData) {
                    if (inputElement.type === 'checkbox') {
                        window.APP.jsonFormData[field.name] = inputElement.checked;
                    } else {
                        window.APP.jsonFormData[field.name] = inputElement.value;
                    }
                }
            });
        }
        
        // Add field label
        const fieldLabel = document.createElement('div');
        fieldLabel.className = 'field-label';
        fieldLabel.textContent = field.name;
        
        // Add focus and blur handlers for highlighting
        fieldContainer.addEventListener('click', () => {
            portfolioEditor.selectField(field.name);
            
            // Focus the input if it's a standard input
            if (inputElement.tagName === 'INPUT') {
                inputElement.focus();
            }
        });
        
        // Add elements to container
        fieldContainer.appendChild(fieldLabel);
        fieldContainer.appendChild(inputElement);
        
        // Add to form overlay
        formOverlay.appendChild(fieldContainer);
    });
}

/**
 * Select a field and show its properties
 */
portfolioEditor.selectField = function(fieldName) {
    // Deselect any previously selected field
    document.querySelectorAll('.form-field.selected').forEach(field => {
        field.classList.remove('selected');
    });
    
    document.querySelectorAll('.field-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Find the field in our array
    portfolioEditor.activeField = portfolioEditor.formFields.find(field => field.name === fieldName);
    if (!portfolioEditor.activeField) return;
    
    // Highlight the field in the overlay
    const fieldElement = document.querySelector(`.form-field[data-field-name="${fieldName}"]`);
    if (fieldElement) {
        fieldElement.classList.add('selected');
    }
    
    // Highlight the field in the list
    const fieldListItem = document.querySelector(`.field-item[data-field-name="${fieldName}"]`);
    if (fieldListItem) {
        fieldListItem.classList.add('selected');
        
        // Scroll to the field in the list if needed
        fieldListItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // Show field properties
    portfolioEditor.showFieldProperties(portfolioEditor.activeField);
}

/**
 * Show properties for the selected field
 */
portfolioEditor.showFieldProperties = function(field) {
    const propertiesForm = document.querySelector('.field-property-form');
    const noFieldMessage = document.querySelector('.no-field-selected');
    
    if (!propertiesForm || !noFieldMessage) return;
    
    // Show properties form
    noFieldMessage.style.display = 'none';
    propertiesForm.style.display = 'block';
    
    // Update properties form with field data
    propertiesForm.innerHTML = `
        <div class="property-group">
            <label>Field Name</label>
            <div class="property-value">${field.name}</div>
        </div>
        <div class="property-group">
            <label>Field Type</label>
            <div class="property-value">${portfolioEditor.capitalizeFirstLetter(field.type)}</div>
        </div>
        <div class="property-group">
            <label>Required</label>
            <div class="property-value">${field.required ? 'Yes' : 'No'}</div>
        </div>
        ${field.default_value ? `
        <div class="property-group">
            <label>Default Value</label>
            <div class="property-value">${field.default_value}</div>
        </div>
        ` : ''}
    `;
}

/**
 * Show the save modal
 */
portfolioEditor.showSaveModal = function() {
    // Collect form data from inputs
    const formValues = portfolioEditor.collectFormValues();
    
    // Show the modal
    const saveModal = document.getElementById('save-modal');
    if (saveModal) {
        // Set modal title
        const modalTitle = saveModal.querySelector('h2');
        if (modalTitle) {
            modalTitle.textContent = portfolioEditor.formData.editingExistingForm ? 'Update Filled Form' : 'Save Filled Form';
        }
        
        // Set confirm button text
        const confirmBtn = document.getElementById('confirm-save');
        if (confirmBtn) {
            confirmBtn.textContent = portfolioEditor.formData.editingExistingForm ? 'Update' : 'Save';
        }
        
        // Show the modal
        saveModal.style.display = 'flex';
    }
}

/**
 * Collect all form values from input elements
 */
portfolioEditor.collectFormValues = function() {
    const formValues = {};
    
    // Process each field input
    Object.keys(portfolioEditor.fieldInputs).forEach(fieldName => {
        const input = portfolioEditor.fieldInputs[fieldName];
        
        if (input) {
            if (input.type === 'signature') {
                // Special handling for signature pads
                formValues[fieldName] = input.getValue();
            } else if (input.type === 'checkbox') {
                formValues[fieldName] = input.checked;
            } else {
                formValues[fieldName] = input.value;
            }
        }
    });
    
    return formValues;
}

/**
 * Save the filled form to the server
 */
portfolioEditor.saveFilledForm = function() {
    // Collect form data from inputs
    const formValues = portfolioEditor.collectFormValues();
    
    // Validate
    if (!portfolioEditor.formData.portfolioId) {
        portfolioEditor.showNotification('Missing portfolio ID', 'error');
        return;
    }
    
    // Show saving notification
    portfolioEditor.showNotification('Saving form...', 'info');
    
    // Hide the modal
    const saveModal = document.getElementById('save-modal');
    if (saveModal) {
        saveModal.style.display = 'none';
    }
    
    // Prepare request data
    const requestData = {
        portfolio_id: portfolioEditor.formData.portfolioId,
        form_data: formValues
    };
    
    // Include filled form ID if editing existing
    if (portfolioEditor.formData.editingExistingForm && portfolioEditor.formData.filledFormId) {
        requestData.filled_form_id = portfolioEditor.formData.filledFormId;
    }
    
    // Send to server
    fetch('/api/fill-form', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            portfolioEditor.showNotification('Form saved successfully', 'success');
            
            // Store ID of the filled form for later use
            localStorage.setItem('filledFormId', data.filled_file_id);
            
            // Show success message and redirect after a delay
            setTimeout(() => {
                window.location.href = '/saved-files';
            }, 2000);
        } else {
            portfolioEditor.showNotification(`Error: ${data.error || 'Unknown error'}`, 'error');
        }
    })
    .catch(error => {
        console.error('Error saving form:', error);
        portfolioEditor.showNotification(`Error saving form: ${error.message}`, 'error');
    });
}

// Utility functions

/**
 * Get icon for field type
 */
portfolioEditor.getFieldIcon = function(fieldType) {
    switch (fieldType) {
        case 'checkbox':
            return 'check_box_outline_blank';
        case 'signature':
            return 'draw';
        case 'date':
            return 'calendar_today';
        default:
            return 'text_fields';
    }
}

/**
 * Capitalize first letter of a string
 */
portfolioEditor.capitalizeFirstLetter = function(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Show a notification to the user
 */
portfolioEditor.showNotification = function(message, type = 'info', duration = 5000, onClick = null) {
    // Use standalone error reporter's notification if available
    if (window.pdfErrorReporter && typeof window.pdfErrorReporter.showNotification === 'function') {
        return window.pdfErrorReporter.showNotification(message, type, duration, onClick);
    }
    
    // Fall back to global showNotification function if available
    if (typeof window.showNotification === 'function') {
        return window.showNotification(message, type, duration, onClick);
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
    
    // Add click handler if provided
    if (typeof onClick === 'function') {
        notification.style.cursor = 'pointer';
        notification.querySelector('span').addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
    }
    
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
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(timeout);
            notification.classList.remove('active');
            setTimeout(() => notification.remove(), 300);
        });
    }
    
    return notification;
}
