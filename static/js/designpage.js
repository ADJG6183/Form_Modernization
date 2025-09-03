// --- Global variables ---
let pdfDoc = null;
let pdfLibDoc = null;
let currentFieldType = null;
let placedFields = [];
let pdfBytesOriginal = null;
let pageNum = 1;
let scale = 1.2;
let renderTask = null;
let pdfPage = null;
let canvas = null;
let ctx = null;
let renderCompleted = false;

// Force reload flag - if set, we'll bypass any cached PDFs
let forceReload = false;

// Check if this is an edit from saved_files page
if (localStorage.getItem('openingFileId')) {
    console.log('Opening file from saved_files page with ID:', localStorage.getItem('openingFileId'));
    // Force a reload of the PDF to ensure we get the latest version
    forceReload = true;
    // Clear the flag after we've used it
    localStorage.removeItem('openingFileId');
}

// Ensure pdfjsLib is available
if (!window.pdfjsLib) {
    console.warn('pdfjsLib not found on window. Attempting to get it from other places...');
    window.pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
}

// Utility: Get DOM element by ID with null check
function getEl(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`Element with id '${id}' not found.`);
    }
    return el;
}

// Function to check if pdfjsLib is available
function isPDFLibraryLoaded() {
    return typeof window.pdfjsLib !== 'undefined' && typeof window.pdfjsLib.getDocument !== 'undefined';
}

// Function to check if PDFLib is available
function isPDFLibAvailable() {
    return typeof window.PDFLib !== 'undefined' && typeof window.PDFLib.PDFDocument !== 'undefined';
}

// Wait for PDFLib library to load
async function waitForPDFLib() {
    return new Promise((resolve, reject) => {
        const maxAttempts = 30; // Increased max attempts
        let attempt = 0;
        
        const checkLib = () => {
            attempt++;
            if (isPDFLibAvailable()) {
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

// Initialize canvas and context - will be called when document is ready
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
    
    // Log error for debugging
    console.trace('PDF error stack trace:');
    
    // Also show the error on canvas if available
    const canvas = getEl('pdf-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            canvas.height = 400;
            canvas.width = 600;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.font = '20px Arial';
            ctx.fillStyle = 'red';
            ctx.fillText('PDF Error: ' + message, 20, 50);
            ctx.font = '16px Arial';
            ctx.fillStyle = '#666';
            ctx.fillText('Please try refreshing the page or re-uploading the file.', 20, 80);
        }
    }
}

// Wait for PDF.js library to load
async function waitForPDFJS() {
    return new Promise((resolve, reject) => {
        const maxAttempts = 20;
        let attempt = 0;
        
        const checkLib = () => {
            attempt++;
            if (isPDFLibraryLoaded()) {
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

// Get PDF URL from various possible sources
// Enhanced function to get PDF URL from various possible sources
function getPDFUrl() {
    // Try getting URL from global variable set in HTML
    if (typeof fileUrl !== 'undefined' && fileUrl) {
        console.log("Using fileUrl from window:", fileUrl);
        return fileUrl;
    }
    
    if (typeof pdfUrl !== 'undefined' && pdfUrl) {
        console.log("Using pdfUrl from HTML template variable");
        return pdfUrl;
    }
    
    // Try getting URL from query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const queryFileUrl = urlParams.get('file_url');
    if (queryFileUrl) {
        console.log("Using PDF URL from query parameters");
        return queryFileUrl;
    }
    
    // Try getting URL from filename parameter (new method)
    const filename = urlParams.get('filename');
    if (filename) {
        console.log("Constructing URL from filename parameter:", filename);
        
        // Construct the file URL based on the current page URL
        const currentUrl = new URL(window.location.href);
        
        // Add leading/trailing slashes to pathname if needed
        let pathname = currentUrl.pathname;
        // Remove filename part if present
        pathname = pathname.split('/').slice(0, -1).join('/');
        
        const serverBasePath = `${currentUrl.protocol}//${currentUrl.host}${pathname}`;
        const constructedUrl = `${serverBasePath}/uploads/${filename}`;
        
        console.log('Constructed file URL from filename:', constructedUrl);
        return constructedUrl;
    }
    
    // Try constructing URL from file ID
    const fileId = document.body.dataset.fileId || 
                 urlParams.get('file_id') || 
                 window.location.pathname.split('/').pop();
    
    if (fileId && !isNaN(parseInt(fileId))) {
        console.log(`Constructing PDF URL from file ID: ${fileId}`);
        return `/serve-pdf/${fileId}`;
    }
    
    // Try localStorage as last resort
    const localStorageUrl = localStorage.getItem('pdfUrl');
    if (localStorageUrl) {
        console.log("Using pdfUrl from localStorage");
        return localStorageUrl;
    }
    
    console.warn("No PDF URL could be determined");
    return null;
}

// --- PDF.js Integration ---
async function loadPDF(url) {
    if (!url) {
        console.error('No PDF URL provided');
        throw new Error('No PDF URL provided');
    }
    
    console.log('Attempting to load PDF from:', url);
    
    if (!window.pdfjsLib) {
        console.error('PDF.js library not available on window object');
        throw new Error('PDF.js library not loaded');
    }
    
    if (!pdfjsLib.getDocument) {
        console.error('PDF.js getDocument method not available');
        throw new Error('PDF.js library incompatible or not fully loaded');
    }
    
    try {
        console.log('Fetching PDF document from URL...');
        // First try to fetch the PDF to verify the URL works
        const response = await fetch(url, {
            // Add cache control to prevent caching issues
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
        
        const contentType = response.headers.get('content-type');
        console.log('Response content type:', contentType);
        
        if (!contentType || !contentType.includes('application/pdf')) {
            console.warn('Response may not be a PDF based on Content-Type:', contentType);
        }
        
        const existingPdfBytes = await response.arrayBuffer();
        console.log('PDF bytes fetched successfully, length:', existingPdfBytes.byteLength);
        
        if (existingPdfBytes.byteLength === 0) {
            throw new Error('Retrieved PDF file is empty');
        }
        
        // Store the original PDF bytes for later use
        pdfBytesOriginal = existingPdfBytes;
        
        // Load with PDF.js for rendering
        console.log('Creating PDF.js loading task...');
        const loadingTask = pdfjsLib.getDocument({ data: existingPdfBytes });        console.log('Waiting for PDF document to load...');
        pdfDoc = await loadingTask.promise;
        console.log('PDF loaded with PDF.js, pages:', pdfDoc.numPages);
        
        // Set initial page number
        pageNum = 1;
        
        // Update page number display
        const pageCounter = document.getElementById('page-count');
        if (pageCounter) {
            pageCounter.textContent = pdfDoc.numPages;
        }
        const pageNumberInput = document.getElementById('page-number');
        if (pageNumberInput) {
            pageNumberInput.value = pageNum;
            pageNumberInput.max = pdfDoc.numPages;
        }
        
        console.log('Attempting to render page', pageNum);
        await renderPage(pageNum);
        console.log('Initial page render completed');
          // Try to load with pdf-lib for editing if available
        try {
            // Wait for PDFLib to be available
            await waitForPDFLib();
            
            // Now PDFLib should be loaded and available
            pdfLibDoc = await PDFLib.PDFDocument.load(existingPdfBytes, { ignoreEncryption: true });
            console.log('PDF loaded with pdf-lib successfully');
            
            // Store the raw PDF bytes as a fallback if needed later
            window.pdfRawBytes = existingPdfBytes;
        } catch (pdfLibErr) {
            console.warn('Error loading PDF with pdf-lib:', pdfLibErr);
            // Continue anyway - we can still view the PDF, but editing may not work
        }
        
        // Hide loading indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        
        // Register page navigation events after successful load
        setupPageNavigation();
        
        return true;
    } catch (err) {
        console.error('PDF load error:', err);
        // Hide loading indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            loadingElement.classList.add('hidden');
        }
        // Graceful degradation: show message on canvas
        const canvas = getEl('pdf-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            canvas.height = 400;
            canvas.width = 600;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.font = '20px Arial';
            ctx.fillStyle = 'red';
            ctx.fillText('Failed to load PDF: ' + err.message, 20, 50);
            ctx.font = '16px Arial';
            ctx.fillStyle = '#666';
            ctx.fillText('Please try uploading the file again.', 20, 80);
        }
        throw err;
    }
}

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
        // Keep track of page number
        pageNum = num;
        
        // Show loading indicator
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            loadingElement.classList.remove('hidden');
        }
        
        console.log(`Getting page ${num} from PDF document...`);
        // Get the page
        pdfPage = await pdfDoc.getPage(num);
        
        // Calculate viewport
        const viewport = pdfPage.getViewport({ scale });
        console.log(`Viewport dimensions: ${viewport.width}x${viewport.height}`);
        
        // Set canvas dimensions
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Render the page
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        console.log('Starting PDF rendering...');
        // Render the page
        renderTask = pdfPage.render(renderContext);
        await renderTask.promise;        
        
        renderCompleted = true;
        console.log('PDF rendering completed successfully');
        
        // Hide loading indicator
        if (loadingElement) {
            console.log('Hiding PDF loading indicator after successful render');
            loadingElement.classList.add('hidden');
        }
        
        console.log(`PDF page ${num} rendered successfully`);
        
        // Update page number display
        const pageNumberInput = document.getElementById('page-number');
        if (pageNumberInput) {
            pageNumberInput.value = num;
        }
          // Draw overlays for placed fields (only those on the current page)
        if (placedFields && placedFields.length > 0) {
            // Filter fields for the current page
            const currentPageFields = placedFields.filter(field => {
                const fieldPage = field.page !== undefined ? field.page : 0;
                return fieldPage === (pageNum - 1); // pageNum is 1-based, field.page is 0-based
            });
            
            console.log(`Drawing ${currentPageFields.length} field overlays for page ${pageNum}`);
            currentPageFields.forEach(field => drawFieldOverlay(ctx, field));
        }
    } catch (err) {
        console.error('Error rendering PDF page:', err);
        showPDFError(`Error rendering page ${num}: ${err.message}`);
    } finally {
        // Ensure loading indicator is always hidden, even if there's an error
        const loadingElement = document.getElementById('pdf-loading');
        if (loadingElement) {
            setTimeout(() => {
                console.log('Final check: hiding PDF loading indicator');
                loadingElement.classList.add('hidden');
            }, 500);
        }
    }
}

function drawFieldOverlay(ctx, field) {
    ctx.save();
    
    // Draw different style for selected fields
    if (field.selected) {
        // Draw selection outline
        ctx.strokeStyle = '#10B981'; // Green color for selected fields
        ctx.lineWidth = 2;
        ctx.strokeRect(field.x, field.y, field.width, field.height);
        
        // Draw filled semi-transparent background for selected fields
        ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
        ctx.fillRect(field.x, field.y, field.width, field.height);
        
        // Draw resize handles
        const handleSize = 6;
        ctx.fillStyle = '#10B981';
        
        // Top-left
        ctx.fillRect(field.x - handleSize/2, field.y - handleSize/2, handleSize, handleSize);
        // Top-right
        ctx.fillRect(field.x + field.width - handleSize/2, field.y - handleSize/2, handleSize, handleSize);
        // Bottom-left
        ctx.fillRect(field.x - handleSize/2, field.y + field.height - handleSize/2, handleSize, handleSize);
        // Bottom-right
        ctx.fillRect(field.x + field.width - handleSize/2, field.y + field.height - handleSize/2, handleSize, handleSize);
        
        // Middle-top
        ctx.fillRect(field.x + field.width/2 - handleSize/2, field.y - handleSize/2, handleSize, handleSize);
        // Middle-right
        ctx.fillRect(field.x + field.width - handleSize/2, field.y + field.height/2 - handleSize/2, handleSize, handleSize);
        // Middle-bottom
        ctx.fillRect(field.x + field.width/2 - handleSize/2, field.y + field.height - handleSize/2, handleSize, handleSize);
        // Middle-left
        ctx.fillRect(field.x - handleSize/2, field.y + field.height/2 - handleSize/2, handleSize, handleSize);
    } else {
        // Standard style for unselected fields
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1;
        ctx.strokeRect(field.x, field.y, field.width, field.height);
    }
    
    // Draw field name
    ctx.font = '14px Arial';
    ctx.fillStyle = field.selected ? '#10B981' : '#2563eb';
    
    // Draw field type icon and name
    let icon = '';
    switch (field.type) {
        case 'text': icon = '📄 '; break;
        case 'number': icon = '🔢 '; break;
        case 'checkbox': icon = '☑️ '; break;
        case 'signature': icon = '✍️ '; break;
    }
    
    // Draw field label
    const displayName = (field.name && field.name.length > 15) ? 
                        field.name.substring(0, 15) + '...' : 
                        field.name;
    
    // Add field info - show more details if selected
    if (field.selected) {
        // Draw the full field name if selected
        ctx.fillText(icon + field.name, field.x + 4, field.y - 6);
        
        // Draw field dimensions
        const dimensionsText = `${Math.round(field.width)}x${Math.round(field.height)}`;
        ctx.font = '10px Arial';
        ctx.fillText(dimensionsText, field.x + field.width - ctx.measureText(dimensionsText).width - 4, field.y + field.height + 14);
        
        // Draw field attributes
        let attributes = [];
        if (field.required) attributes.push('Required');
        if (field.readonly) attributes.push('ReadOnly');
        
        if (attributes.length > 0) {
            ctx.fillText(attributes.join(', '), field.x + 4, field.y + field.height + 14);
        }
    } else {
        // For unselected fields, just show the abbreviated name
        ctx.fillText(icon + displayName, field.x + 4, field.y - 6);
    }
    
    ctx.restore();
}

// --- Field Selection and Utility Functions ---

// Check if a point is inside a field
function isPointInField(x, y, field) {
    return x >= field.x && 
           x <= field.x + field.width && 
           y >= field.y && 
           y <= field.y + field.height;
}

// Get the field at a specific position
function getFieldAtPosition(x, y) {
    // Check only fields on current page
    const currentPageFields = placedFields.filter(field => 
        field.page === pageNum - 1
    );
    
    // Go in reverse order so we select the topmost field if they overlap
    for (let i = currentPageFields.length - 1; i >= 0; i--) {
        const field = currentPageFields[i];
        if (isPointInField(x, y, field)) {
            // Return the index in the original placedFields array
            return placedFields.findIndex(f => f === field);
        }
    }
    return -1; // No field found at this position
}

// Select a field and update the UI
function selectField(fieldIndex) {
    if (fieldIndex < 0 || fieldIndex >= placedFields.length) return;
    
    // Deselect all other fields
    placedFields.forEach((field, i) => {
        field.selected = (i === fieldIndex);
    });
    
    // Update the properties panel
    updateFieldPropertiesPanel(fieldIndex);
    
    // Re-render to show the selection
    renderPage(pageNum);
}

// Update the field properties panel with the selected field's data
function updateFieldPropertiesPanel(fieldIndex) {
    if (fieldIndex < 0 || fieldIndex >= placedFields.length) return;
    
    const field = placedFields[fieldIndex];
    
    // Update field name input
    const fieldNameInput = document.getElementById('fieldName');
    if (fieldNameInput) {
        fieldNameInput.value = field.name || '';
    }
    
    // Update required checkbox
    const requiredCheckbox = document.getElementById('required');
    if (requiredCheckbox) {
        requiredCheckbox.checked = field.required || false;
    }
    
    // Update readonly checkbox
    const readonlyCheckbox = document.getElementById('readonly');
    if (readonlyCheckbox) {
        readonlyCheckbox.checked = field.readonly || false;
    }
    
    // Add event listeners to update field properties when changed
    if (fieldNameInput) {
        fieldNameInput.oninput = function() {
            field.name = fieldNameInput.value;
            renderPage(pageNum);
        };
    }
    
    if (requiredCheckbox) {
        requiredCheckbox.onchange = function() {
            field.required = requiredCheckbox.checked;
        };
    }
    
    if (readonlyCheckbox) {
        readonlyCheckbox.onchange = function() {
            field.readonly = readonlyCheckbox.checked;
        };
    }
}

// Clear the field properties panel
function clearFieldPropertiesPanel() {
    const fieldNameInput = document.getElementById('fieldName');
    if (fieldNameInput) {
        fieldNameInput.value = '';
        fieldNameInput.oninput = null;
    }
    
    const requiredCheckbox = document.getElementById('required');
    if (requiredCheckbox) {
        requiredCheckbox.checked = false;
        requiredCheckbox.onchange = null;
    }
    
    const readonlyCheckbox = document.getElementById('readonly');
    if (readonlyCheckbox) {
        readonlyCheckbox.checked = false;
        readonlyCheckbox.onchange = null;
    }
}

// --- Field Type Selection ---
function selectFieldType(type) {
    currentFieldType = type;
    
    // Change cursor to indicate field placement mode
    if (pdfCanvas) {
        if (type) {
            pdfCanvas.classList.add('placing-field');
        } else {
            pdfCanvas.classList.remove('placing-field');
        }
    }
    
    // Highlight the active button
    ['addTextBox', 'addSignature', 'addCheckbox', 'addNumber'].forEach(id => {
        const btn = getEl(id);
        if (btn) btn.classList.remove('active');
    });
    
    if (type) {
        const activeBtn = getEl('add' + type.charAt(0).toUpperCase() + type.slice(1));
        if (activeBtn) activeBtn.classList.add('active');
    }
    
    // Show a helpful tooltip
    if (type) {
        const fieldTypeName = {
            'text': 'Text Field',
            'signature': 'Signature Field',
            'checkbox': 'Checkbox',
            'number': 'Number Field'
        }[type] || type;
        
        console.log(`Ready to place ${fieldTypeName}. Click on the PDF to place the field.`);
    }
}

// --- Canvas Click to Place Field ---
// Variables for field dragging
let isDragging = false;
let dragFieldIndex = -1;
let isResizing = false;
let resizeDirection = '';
let startX, startY, originalX, originalY, originalWidth, originalHeight;

const pdfCanvas = getEl('pdf-canvas');
if (pdfCanvas) {
    // Ensure canvas context is initialized
    let ctx = pdfCanvas.getContext('2d');
    if (!ctx) {
        console.error('Failed to get 2D context for canvas.');
    }
    
    // Click handler for adding new fields
    pdfCanvas.addEventListener('click', function(e) {
        // Don't add a field if we're in the middle of a drag or resize operation
        if (isDragging || isResizing) return;
        
        if (!currentFieldType) return;
        const rect = pdfCanvas.getBoundingClientRect();
        // Use relative positioning (percentages)
        const x = ((e.clientX - rect.left) / rect.width) * pdfCanvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * pdfCanvas.height;
        
        // Check if we clicked on an existing field (for selection)
        const fieldIndex = getFieldAtPosition(x, y);
        if (fieldIndex !== -1) {
            // If a field already exists at this position, select it instead of creating a new one
            selectField(fieldIndex);
            return;
        }
        
        // Get field properties from the UI
        const fieldNameInput = document.getElementById('fieldName');
        const requiredCheckbox = document.getElementById('required');
        const readonlyCheckbox = document.getElementById('readonly');
        
        // Generate a default field name with current page number
        const defaultName = `${currentFieldType}_p${pageNum}_${placedFields.length + 1}`;
        const fieldName = fieldNameInput && fieldNameInput.value ? 
            fieldNameInput.value : 
            prompt('Field name:', defaultName);
        
        if (!fieldName) return;
        
        // Set default dimensions based on field type
        let width = 150, height = 24;
        if (currentFieldType === 'checkbox') { width = height = 20; }
        if (currentFieldType === 'signature') { width = 200; height = 40; }
        
        // Store the field with its page number and properties
        const newField = { 
            type: currentFieldType, 
            name: fieldName, 
            x, 
            y, 
            width, 
            height, 
            page: pageNum - 1,  // PDF-lib uses 0-based page indexing
            required: requiredCheckbox && requiredCheckbox.checked,
            readonly: readonlyCheckbox && readonlyCheckbox.checked,
            fontSize: 12,
            selected: true // Mark as selected initially
        };
        
        // Deselect all other fields
        placedFields.forEach(field => field.selected = false);
        
        // Add the new field
        placedFields.push(newField);
        
        console.log(`Field "${fieldName}" added to page ${pageNum} at (${x}, ${y})`);
        
        // Update the properties panel with this field's info
        updateFieldPropertiesPanel(placedFields.length - 1);
        
        // Re-render the current page to show the field
        renderPage(pageNum);
        
        // Keep the current field type for continuous placement
        // Only reset if shift key wasn't pressed during click
        if (!e.shiftKey) {
            currentFieldType = null;
            // Remove active class from buttons
            ['addTextBox', 'addSignature', 'addCheckbox', 'addNumber'].forEach(id => {
                const btn = getEl(id);
                if (btn) btn.classList.remove('active');
            });
        }
    });
    
    // Mouse down handler for beginning drag operations
    pdfCanvas.addEventListener('mousedown', function(e) {
        if (currentFieldType) return; // Don't start drag if we're placing a new field
        
        const rect = pdfCanvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * pdfCanvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * pdfCanvas.height;
        
        // Check if we clicked on a field
        const fieldIndex = getFieldAtPosition(x, y);
        if (fieldIndex !== -1) {
            const field = placedFields[fieldIndex];
            
            // Check if we're clicking near an edge for resizing
            const resizeHandleSize = 8; // Size of the resize handle area in pixels
            const isNearRight = Math.abs((field.x + field.width) - x) < resizeHandleSize;
            const isNearBottom = Math.abs((field.y + field.height) - y) < resizeHandleSize;
            const isNearLeft = Math.abs(field.x - x) < resizeHandleSize;
            const isNearTop = Math.abs(field.y - y) < resizeHandleSize;
            
            // Start resizing if near an edge
            if (isNearRight || isNearBottom || isNearLeft || isNearTop) {
                isResizing = true;
                resizeDirection = '';
                if (isNearRight) resizeDirection += 'e';
                if (isNearBottom) resizeDirection += 's';
                if (isNearLeft) resizeDirection += 'w';
                if (isNearTop) resizeDirection += 'n';
                
                // Store the original dimensions for the resize operation
                originalX = field.x;
                originalY = field.y;
                originalWidth = field.width;
                originalHeight = field.height;
                startX = x;
                startY = y;
                dragFieldIndex = fieldIndex;
                
                // Mark this field as selected
                placedFields.forEach((f, i) => f.selected = (i === fieldIndex));
                
                // Set cursor based on resize direction
                if (resizeDirection === 'e' || resizeDirection === 'w') document.body.style.cursor = 'ew-resize';
                else if (resizeDirection === 's' || resizeDirection === 'n') document.body.style.cursor = 'ns-resize';
                else if (resizeDirection === 'se' || resizeDirection === 'nw') document.body.style.cursor = 'nwse-resize';
                else if (resizeDirection === 'sw' || resizeDirection === 'ne') document.body.style.cursor = 'nesw-resize';
            } else {
                // Start dragging the field
                isDragging = true;
                dragFieldIndex = fieldIndex;
                startX = x;
                startY = y;
                originalX = field.x;
                originalY = field.y;
                
                // Mark this field as selected
                placedFields.forEach((f, i) => f.selected = (i === fieldIndex));
                document.body.style.cursor = 'move';
            }
            
            // Update the properties panel
            updateFieldPropertiesPanel(fieldIndex);
            
            // Re-render to show the selection
            renderPage(pageNum);
        } else {
            // Clicked on empty space, deselect all fields
            const hadSelection = placedFields.some(field => field.selected);
            placedFields.forEach(field => field.selected = false);
            
            // Clear properties panel
            clearFieldPropertiesPanel();
            
            // Only re-render if we had a selection to clear
            if (hadSelection) {
                renderPage(pageNum);
            }
        }
    });
    
    // Mouse move handler for dragging and resizing
    pdfCanvas.addEventListener('mousemove', function(e) {
        const rect = pdfCanvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * pdfCanvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * pdfCanvas.height;
        
        // Handle field resizing
        if (isResizing && dragFieldIndex !== -1) {
            const field = placedFields[dragFieldIndex];
            const deltaX = x - startX;
            const deltaY = y - startY;
            
            // Apply resizing based on direction
            if (resizeDirection.includes('e')) {
                field.width = Math.max(20, originalWidth + deltaX);
            } else if (resizeDirection.includes('w')) {
                const newWidth = Math.max(20, originalWidth - deltaX);
                field.x = originalX + (originalWidth - newWidth);
                field.width = newWidth;
            }
            
            if (resizeDirection.includes('s')) {
                field.height = Math.max(20, originalHeight + deltaY);
            } else if (resizeDirection.includes('n')) {
                const newHeight = Math.max(20, originalHeight - deltaY);
                field.y = originalY + (originalHeight - newHeight);
                field.height = newHeight;
            }
            
            // Re-render the page to show the resized field
            renderPage(pageNum);
            return;
        }
        
        // Handle field dragging
        if (isDragging && dragFieldIndex !== -1) {
            const field = placedFields[dragFieldIndex];
            
            // Calculate the new position
            const deltaX = x - startX;
            const deltaY = y - startY;
            field.x = originalX + deltaX;
            field.y = originalY + deltaY;
            
            // Re-render the page to show the dragged field
            renderPage(pageNum);
            return;
        }
        
        // Change cursor when hovering over field edges (for resize handles)
        if (!isDragging && !isResizing && !currentFieldType) {
            // Reset cursor
            document.body.style.cursor = 'default';
            
            // Check if mouse is over any field's resize handles
            for (let i = 0; i < placedFields.length; i++) {
                const field = placedFields[i];
                if (field.page !== pageNum - 1) continue;
                
                const resizeHandleSize = 8; // Size of the resize handle area in pixels
                const isNearRight = Math.abs((field.x + field.width) - x) < resizeHandleSize;
                const isNearBottom = Math.abs((field.y + field.height) - y) < resizeHandleSize;
                const isNearLeft = Math.abs(field.x - x) < resizeHandleSize;
                const isNearTop = Math.abs(field.y - y) < resizeHandleSize;
                
                if (isNearRight && isNearBottom) {
                    document.body.style.cursor = 'nwse-resize';
                    break;
                } else if (isNearLeft && isNearTop) {
                    document.body.style.cursor = 'nwse-resize';
                    break;
                } else if (isNearRight && isNearTop) {
                    document.body.style.cursor = 'nesw-resize';
                    break;
                } else if (isNearLeft && isNearBottom) {
                    document.body.style.cursor = 'nesw-resize';
                    break;
                } else if (isNearRight || isNearLeft) {
                    document.body.style.cursor = 'ew-resize';
                    break;
                } else if (isNearTop || isNearBottom) {
                    document.body.style.cursor = 'ns-resize';
                    break;
                } else if (isPointInField(x, y, field)) {
                    document.body.style.cursor = 'move';
                    break;
                }
            }
        }
    });
    
    // Mouse up handler to end drag operations
    pdfCanvas.addEventListener('mouseup', function() {
        isDragging = false;
        isResizing = false;
        document.body.style.cursor = 'default';
    });
    
    // Mouse leave handler to end drag operations
    pdfCanvas.addEventListener('mouseleave', function() {
        isDragging = false;
        isResizing = false;
        document.body.style.cursor = 'default';
    });
}

// --- Toolbar Button Logic ---
const btnText = getEl('addTextBox');
const btnSig = getEl('addSignature');
const btnCheck = getEl('addCheckbox');
const btnNum = getEl('addNumber');
if (btnText) btnText.onclick = () => selectFieldType('text');
if (btnSig) btnSig.onclick = () => selectFieldType('signature');
if (btnCheck) btnCheck.onclick = () => selectFieldType('checkbox');
if (btnNum) btnNum.onclick = () => selectFieldType('number');

// --- Save Button Logic ---
// Function to save PDF with fields
async function savePDFWithFields(filename) {
    console.log('Starting savePDFWithFields with filename:', filename);
    
    // If pdfLibDoc is not initialized, try to initialize it from raw bytes
    if (!pdfLibDoc) {
        console.warn('PDF document not loaded via PDFLib yet, attempting to create it now');
        
        try {
            // Wait for PDFLib to be available
            await waitForPDFLib();
            
            // Get the URL from various sources            let url = null;
            if (typeof fileUrl !== 'undefined' && fileUrl) {
                console.log('Using fileUrl from window for PDF reload:', fileUrl);
                url = fileUrl;
            } else if (localStorage.getItem('pdfUrl')) {
                console.log('Using pdfUrl from localStorage for PDF reload');
                url = localStorage.getItem('pdfUrl');
            } else {
                // Try to construct from the page
                const fileId = document.body.dataset.fileId;
                if (fileId) {
                    url = `/serve-pdf/${fileId}`;
                    console.log('Constructed URL from fileId for PDF reload:', url);
                }
            }
            
            if (!url) {
                throw new Error('No PDF URL available for reloading');
            }
            
            // Ensure we're getting the latest version by refreshing the URL
            url = refreshFileURL(url);
            console.log('Using refreshed URL for PDF loading:', url);
            
            // If we have the raw bytes stored, use them
            if (window.pdfRawBytes) {
                console.log('PDF recreating from raw bytes, size:', window.pdfRawBytes.byteLength);
                pdfLibDoc = await PDFLib.PDFDocument.load(window.pdfRawBytes, { ignoreEncryption: true });
                console.log('PDF recreated from raw bytes for saving');
            } else {
                // If no raw bytes, try to fetch the PDF again
                console.log('Fetching PDF again for saving from URL:', url);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
                }
                const pdfBytes = await response.arrayBuffer();
                console.log('PDF fetched, size:', pdfBytes.byteLength);
                if (pdfBytes.byteLength === 0) {
                    throw new Error('Retrieved PDF file is empty');
                }
                pdfLibDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                console.log('PDF fetched and loaded for saving');
                
                // Store for future use
                window.pdfRawBytes = pdfBytes;
            }
        } catch (err) {
            console.error('Failed to initialize PDF document for saving:', err);
            alert('Failed to prepare PDF for saving: ' + err.message);
            return false;
        }
    }
    
    // Double-check that we now have a valid PDF document
    if (!pdfLibDoc) {
        const errMsg = 'PDF document could not be loaded for saving';
        console.error(errMsg);
        alert(errMsg);
        return false;
    }
    
    try {
        console.log('Starting save process with filename:', filename);
        
        // For multi-page PDFs, we need to iterate through all pages
        const numberOfPages = pdfLibDoc.getPageCount();
        console.log(`PDF has ${numberOfPages} page(s)`);
          // If no form exists, create one
        if (!pdfLibDoc.getForm()) {
            console.log('Creating new form in PDF');
            pdfLibDoc.attachForm();
        }
        
        const form = pdfLibDoc.getForm();
        
        // Set the NeedAppearances flag to ensure fields render correctly when opened in PDF viewers
        // pdf-lib does not provide setNeedAppearances; set it manually on the AcroForm dict
        const acroForm = pdfLibDoc.context.lookup(pdfLibDoc.catalog.get(PDFLib.PDFName.of('AcroForm')));
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
                drDict = pdfLibDoc.context.obj({});
                acroForm.set(PDFLib.PDFName.of('DR'), drDict);
            }
            
            // Ensure there's a Font dictionary in DR
            let fontDict = drDict.get(PDFLib.PDFName.of('Font'));
            if (!fontDict) {
                fontDict = pdfLibDoc.context.obj({});
                drDict.set(PDFLib.PDFName.of('Font'), fontDict);
                
                // Add at least Helvetica font to the Font dictionary
                const helveticaRef = pdfLibDoc.context.register(
                    pdfLibDoc.context.obj({
                        Type: PDFLib.PDFName.of('Font'),
                        Subtype: PDFLib.PDFName.of('Type1'),
                        BaseFont: PDFLib.PDFName.of('Helvetica')
                    })
                );
                fontDict.set(PDFLib.PDFName.of('Helv'), helveticaRef);
            }
            console.log('Set /NeedAppearances flag and additional AcroForm properties');
        } else {
            console.warn('AcroForm not found when trying to set /NeedAppearances');
        }
          // Organize fields by page
        const fieldsByPage = {};
        placedFields.forEach(field => {
            const pageIndex = field.page !== undefined ? field.page : 0;
            if (!fieldsByPage[pageIndex]) {
                fieldsByPage[pageIndex] = [];
            }
            fieldsByPage[pageIndex].push(field);
        });
        
        // Add fields to each page
        for (const [pageIndex, fields] of Object.entries(fieldsByPage)) {
            // Skip if page doesn't exist in the document
            if (parseInt(pageIndex) >= numberOfPages) {
                console.warn(`Page ${pageIndex} doesn't exist in the document. Skipping fields.`);
                continue;
            }
            
            // Get the page for these fields
            const page = pdfLibDoc.getPage(parseInt(pageIndex));
            const pageHeight = page.getHeight();
            
            console.log(`Adding ${fields.length} fields to page ${parseInt(pageIndex) + 1}`);
            
            // Add each field to this page
            fields.forEach(field => {
                // PDF coordinates start from bottom-left, our canvas coordinates from top-left
                // So we need to flip the y-coordinate
                const pdfY = pageHeight - field.y - field.height;
                
                console.log(`Adding ${field.type} field "${field.name}" at x:${field.x}, y:${pdfY}, width:${field.width}, height:${field.height}`);
                
                try {                    switch (field.type) {
                        case 'text':
                            const textField = form.createTextField(field.name);
                            
                            // Configure text field for best compatibility
                            textField.setText(field.defaultValue || '')
                                   .enableMultiline()
                                   .setFontSize(field.fontSize || 12)
                                   .setAlignment(PDFLib.TextAlignment.Left)
                                   .enableEditing()
                                   .addToPage(page, { 
                                        x: field.x, 
                                        y: pdfY, 
                                        width: field.width, 
                                        height: field.height 
                                    });
                            
                            // Set field properties if specified
                            if (field.required) textField.enableRequired();
                            if (field.readonly) textField.disableEditing();
                            break;
                            
                        case 'number':
                            const numField = form.createTextField(field.name);
                            
                            numField.setText(field.defaultValue || '')
                                  .enableFormatting()
                                  .setFontSize(field.fontSize || 12)
                                  .enableEditing()
                                  .addToPage(page, { 
                                      x: field.x, 
                                      y: pdfY, 
                                      width: field.width, 
                                      height: field.height 
                                  });
                                  
                            // Set field properties if specified
                            if (field.required) numField.enableRequired();
                            if (field.readonly) numField.disableEditing();
                            break;
                            
                        case 'checkbox':
                            const checkBox = form.createCheckBox(field.name);
                            
                            checkBox.addToPage(page, { 
                                x: field.x, 
                                y: pdfY, 
                                width: field.width, 
                                height: field.height 
                            });
                            
                            // Set default value if specified
                            if (field.checked) checkBox.check();
                            if (field.required) checkBox.enableRequired();
                            break;
                            
                        case 'signature':
                            const sigField = form.createSignature(field.name);
                            
                            sigField.addToPage(page, { 
                                x: field.x, 
                                y: pdfY, 
                                width: field.width, 
                                height: field.height 
                            });
                            
                            if (field.required) sigField.enableRequired();
                            break;
                    }
                } catch (fieldErr) {
                    console.error(`Error adding field ${field.name}:`, fieldErr);
                    // Continue with other fields
                }
            });
        }
          // Save the PDF with form fields
        console.log('Saving PDF with fields...');
        const pdfBytes = await pdfLibDoc.save({ 
            useObjectStreams: false,
            addDefaultAppearance: true,
            updateFieldAppearances: true
        });
        
        // Download client-side
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
          // Upload to backend for persistence
        const formData = new FormData();
        formData.append('file', new File([pdfBytes], filename, { type: 'application/pdf' }));
        
        console.log('Uploading to server...');
        const response = await fetch('/save-form', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        if (result.success) {
            console.log('Form saved successfully with ID:', result.id);
            
            // Store the file ID in local storage to help with reopening
            localStorage.setItem('lastSavedFileId', result.id);
            localStorage.setItem('lastSavedFileName', result.name);
            
            // Show success notification if available
            if (typeof showNotification === 'function') {
                showNotification(`
                    <strong>Form saved successfully!</strong><br>
                    The form fields are now permanently embedded in the PDF and will remain editable when reopened.
                    <br><a href="/design/${result.id}" style="color: white; text-decoration: underline;">Click here to reopen</a>
                `, 'success');
            }
            
            return true;
        } else {
            console.error('Server returned error:', result.error);
            // Show error notification
            if (typeof showNotification === 'function') {
                showNotification(`
                    <strong>Error saving form:</strong><br>
                    ${result.error || 'Unknown error occurred'}
                `, 'error');
            }
            return false;
        }
    } catch (err) {
        console.error('Error saving PDF:', err);
        return false;
    }
}

// Save button click handler
const saveBtn = getEl('save-btn');
if (saveBtn) saveBtn.onclick = function() {
    // Show the save modal
    const saveModal = document.getElementById('save-modal');
    if (saveModal) {
        // Suggest a filename based on original PDF
        const fileInput = document.getElementById('save-filename');
        if (fileInput) {
            // Extract original filename from page title or URL
            const pageTitle = document.title;
            let suggestedName = '';
            
            if (pageTitle && pageTitle.includes('-')) {
                // Extract from page title
                const filePart = pageTitle.split('-')[1].trim();
                suggestedName = filePart === 'No File' ? 'new_form.pdf' : filePart;
            } else {
                // Extract from URL if possible
                const urlParts = fileUrl.split('/');
                const lastPart = urlParts[urlParts.length - 1];
                if (lastPart && lastPart.includes('.')) {
                    suggestedName = lastPart;
                } else {
                    suggestedName = 'new_form.pdf';
                }
            }
            
            // Ensure it ends with .pdf
            if (!suggestedName.toLowerCase().endsWith('.pdf')) {
                suggestedName += '.pdf';
            }
            
            fileInput.value = suggestedName;
        }
        
        saveModal.style.display = 'flex';
    }
};

// Cancel save button handler
const cancelSaveBtn = document.getElementById('cancel-save');
if (cancelSaveBtn) {
    cancelSaveBtn.onclick = function() {
        const saveModal = document.getElementById('save-modal');
        if (saveModal) {
            saveModal.style.display = 'none';
        }
    };
}

// Confirm save button handler
const confirmSaveBtn = document.getElementById('confirm-save');
if (confirmSaveBtn) {
    confirmSaveBtn.onclick = async function() {
        try {
            const fileInput = document.getElementById('save-filename');
            let filename = fileInput ? fileInput.value.trim() : 'new_form.pdf';
            
            // Ensure filename ends with .pdf
            if (!filename.toLowerCase().endsWith('.pdf')) {
                filename += '.pdf';
            }
            
            // Hide the modal
            const saveModal = document.getElementById('save-modal');
            if (saveModal) {
                saveModal.style.display = 'none';
            }
            
            // Show saving indicator
            const loadingEl = document.getElementById('pdf-loading');
            if (loadingEl) {
                // Find the text element
                let loadingText = loadingEl.querySelector('p');
                if (loadingText) loadingText.textContent = 'Saving form...';
                loadingEl.classList.remove('hidden');
            }
            
            console.log('Starting PDF save process for file:', filename);
            
            // Wait for PDFLib to be loaded if needed
            if (!window.PDFLib) {
                console.log('PDFLib not loaded yet, waiting...');
                try {
                    await waitForPDFLib();
                    console.log('PDFLib loaded successfully for save operation');
                } catch (err) {
                    console.error('Failed to load PDFLib:', err);
                    throw new Error('PDF editing library unavailable. Please refresh and try again.');
                }
            }
            
            // Save the PDF with fields
            const success = await savePDFWithFields(filename);
            
            // Hide loading indicator
            if (loadingEl) {
                loadingEl.classList.add('hidden');
            }
            
            // Show result
            if (success) {
                alert('Form saved successfully! You can find it in your saved forms.');
                window.location.href = '/saved-files';
            } else {
                alert('There was a problem saving the form. Please try again.');
            }
        } catch (error) {
            console.error('Error in save process:', error);
            // Hide loading indicator
            const loadingEl = document.getElementById('pdf-loading');
            if (loadingEl) {
                loadingEl.classList.add('hidden');
            }
            alert('Error saving the form: ' + error.message);
        }
    };
}

// --- Page Navigation Setup ---
function setupPageNavigation() {
    console.log('Setting up page navigation');
    
    // Get navigation elements
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    const pageInput = document.getElementById('page-number');
    
    // Set up previous page button
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (pageNum <= 1) return;
            pageNum--;
            renderPage(pageNum);
        });
    }
    
    // Set up next page button
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (pageNum >= pdfDoc.numPages) return;
            pageNum++;
            renderPage(pageNum);
        });
    }
    
    // Set up page input
    if (pageInput) {
        pageInput.addEventListener('change', () => {
            const num = parseInt(pageInput.value);
            if (isNaN(num) || num < 1 || num > pdfDoc.numPages) {
                // Reset to current page if invalid
                pageInput.value = pageNum;
                return;
            }
            pageNum = num;
            renderPage(pageNum);
        });
    }
    
    console.log('Page navigation setup complete');
}

// --- Function to get the latest URL with a cache-busting parameter
function refreshFileURL(url) {
    if (!url) return null;
    
    // Check if we need to force a reload
    if (forceReload) {
        console.log('Force reloading PDF from server (bypassing cache)');

        // Add a timestamp to the URL to ensure we don't get a cached version
        const separator = url.indexOf('?') !== -1 ? '&' : '?';
        return `${url}${separator}t=${Date.now()}`;
    }
    
    return url;
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOMContentLoaded event fired');
    
    // First setup the canvas element
    if (!setupCanvas()) {
        alert('Could not initialize the PDF canvas. Please refresh the page and try again.');
        return;
    }
    
    // Show welcome instructions if available
    if (typeof showNotification === 'function') {
        showNotification(`
            <strong>Welcome to the Form Editor!</strong><br>
            1. Select a field type from the left panel<br>
            2. Click on the PDF to place fields<br>
            3. Drag fields to reposition them<br>
            4. Use the resize handles to adjust size<br>
            5. Press Delete key to remove fields<br>
            6. Save when you're done
        `, 'info', 10000);
    }
    
    // Get file ID from data attribute or URL
    let fileId = document.body.dataset.fileId;
    if (!fileId) {
        fileId = new URLSearchParams(window.location.search).get('file_id');
    }
    console.log('File ID:', fileId);
    
    // Get file URL from multiple sources
    let url = null;
    
    // First priority: window.fileUrl (set by the template)
    if (typeof fileUrl !== 'undefined' && fileUrl) {
        console.log('Using fileUrl from window:', fileUrl);
        url = fileUrl;
    }
    // Second priority: localStorage
    else if (localStorage.getItem('pdfUrl')) {
        console.log('Using pdfUrl from localStorage');
        url = localStorage.getItem('pdfUrl');
    }
    // Third priority: construct from fileId
    else if (fileId) {
        console.log('Constructing URL from fileId');
        // Use serve-pdf endpoint instead of api/design/file
        url = `/serve-pdf/${fileId}`;
        
        // Store the URL in the localStorage as well
        localStorage.setItem('pdfUrl', url);
    }
    
    console.log('Final PDF URL to use:', url);
    
    if (!url) {
        alert('No PDF file URL provided. Please upload a file first.');
        console.error('No PDF URL available to load');
        // Redirect to upload page after a delay
        setTimeout(() => {
            window.location.href = '/start-editing';
        }, 2000);
        return;
    }
    
    // Show loading indicator
    const loadingElement = document.getElementById('pdf-loading');
    if (loadingElement) {
        loadingElement.classList.remove('hidden');
    }
    
    // Add a more robust timeout to ensure loading indicator eventually hides
    const loadingTimeout = setTimeout(() => {
        if (loadingElement && !renderCompleted) {
            console.log('Timeout reached: Hiding loading indicator after 15 seconds');
            loadingElement.classList.add('hidden');
            
            // Check if we need to show an error
            const canvas = document.getElementById('pdf-canvas');
            if (canvas && (!canvas.width || canvas.width < 10)) {
                showPDFError('PDF failed to render properly after timeout. Try refreshing the page.');
            }
        }
    }, 15000); // 15 second safety timeout
      try {
        // Wait for PDF.js to be available before proceeding
        await waitForPDFJS();
        
        // Try to wait for PDFLib as well but don't block if it fails
        try {
            await waitForPDFLib();
        } catch (pdfLibErr) {
            console.warn('PDFLib not available or failed to load. Some editing features may not work.', pdfLibErr);
        }
        
        // Now load the PDF
        await loadPDF(url);
        
        // If we reach here, PDF has loaded, clear the timeout
        clearTimeout(loadingTimeout);
    } catch (err) {
        console.error('Error initializing PDF form builder:', err);
        showPDFError(err.message);
        
        // Clear the timeout
        clearTimeout(loadingTimeout);
    }
});

console.log("Initializing PDF viewer");
console.log("PDF URL from page:", typeof pdfUrl !== 'undefined' ? pdfUrl : "Not defined");

// Test direct fetch of the PDF
if (typeof pdfUrl !== 'undefined') {
    console.log("Testing PDF URL access...");
    fetch(pdfUrl)
        .then(response => {
            console.log("PDF Fetch Response:", response.status, response.statusText);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
            }
            return response.blob();
        })
        .then(blob => {
            console.log("PDF fetched successfully. Size:", blob.size, "bytes");
        })
        .catch(error => {
            console.error("Error fetching PDF:", error);
        });
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', function(e) {
    // Only process if we have fields on the current page
    const currentPageFields = placedFields.filter(field => field.page === pageNum - 1);
    if (currentPageFields.length === 0) return;
    
    // Get selected field index
    const selectedIndex = placedFields.findIndex(field => field.selected);
    if (selectedIndex === -1 && !['a'].includes(e.key.toLowerCase())) return;
    
    const field = placedFields[selectedIndex];
    
    // Handle different key commands
    switch (e.key.toLowerCase()) {
        case 'delete':
        case 'backspace':
            // Delete selected field
            if (selectedIndex !== -1) {
                e.preventDefault();
                placedFields.splice(selectedIndex, 1);
                clearFieldPropertiesPanel();
                renderPage(pageNum);
            }
            break;
            
        case 'arrowleft':
            // Move field left
            if (field) {
                e.preventDefault();
                field.x -= e.shiftKey ? 10 : 1;
                renderPage(pageNum);
            }
            break;
            
        case 'arrowright':
            // Move field right
            if (field) {
                e.preventDefault();
                field.x += e.shiftKey ? 10 : 1;
                renderPage(pageNum);
            }
            break;
            
        case 'arrowup':
            // Move field up
            if (field) {
                e.preventDefault();
                field.y -= e.shiftKey ? 10 : 1;
                renderPage(pageNum);
            }
            break;
            
        case 'arrowdown':
            // Move field down
            if (field) {
                e.preventDefault();
                field.y += e.shiftKey ? 10 : 1;
                renderPage(pageNum);
            }
            break;
            
        case 'c':
            // Copy field (Ctrl+C)
            if (e.ctrlKey && field) {
                e.preventDefault();
                window.copiedField = JSON.parse(JSON.stringify(field));
                console.log('Field copied:', field.name);
            }
            break;
            
        case 'v':
            // Paste field (Ctrl+V)
            if (e.ctrlKey && window.copiedField) {
                e.preventDefault();
                const newField = JSON.parse(JSON.stringify(window.copiedField));
                newField.name = newField.name + '_copy';
                newField.x += 20; // Offset slightly
                newField.y += 20;
                newField.page = pageNum - 1; // Paste to current page
                newField.selected = true;
                
                // Deselect other fields
                placedFields.forEach(f => f.selected = false);
                
                // Add the copied field
                placedFields.push(newField);
                updateFieldPropertiesPanel(placedFields.length - 1);
                renderPage(pageNum);
            }
            break;
            
        case 'a':
            // Select all fields (Ctrl+A)
            if (e.ctrlKey) {
                e.preventDefault();
                const fieldsOnCurrentPage = placedFields.filter(field => field.page === pageNum - 1);
                if (fieldsOnCurrentPage.length > 0) {
                    placedFields.forEach(field => {
                        if (field.page === pageNum - 1) {
                            field.selected = true;
                        }
                    });
                    renderPage(pageNum);
                }
            }
            break;
    }
});