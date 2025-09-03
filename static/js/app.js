function initializeFileUpload() {
    const browseButton = document.getElementById('browse-files');
    const fileInput = document.getElementById('file-input');
    const uploadProgress = document.getElementById('upload-progress');
    const progressBar = document.getElementById('progress-bar');
    const uploadStatus = document.getElementById('upload-status');
    const uploadPercentage = document.getElementById('upload-percentage');

    // Exit if required elements aren't found
    if (!browseButton || !fileInput) {
        console.error('Required upload elements not found');
        return;
    }

    // Ensure the browse button triggers the file input
    browseButton.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
    };

    // File selection handler
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        for (const file of files) {
            // Validate file type
            const fileExt = file.name.split('.').pop().toLowerCase();
            if (!['docx', 'pdf'].includes(fileExt)) {
                alert('Only .docx and .pdf files are supported');
                continue;
            }

            // Show upload progress
            uploadProgress.classList.remove('hidden');
            uploadStatus.textContent = `Uploading ${file.name}...`;
            
            try {
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Upload failed');
                }

                // Update UI for success
                progressBar.style.width = '100%';
                uploadPercentage.textContent = '100%';
                uploadStatus.textContent = 'Upload complete!';

                // Refresh file list
                if (typeof loadFiles === 'function') {
                    loadFiles();
                }

                // Reset form after delay
                setTimeout(() => {
                    uploadProgress.classList.add('hidden');
                    progressBar.style.width = '0%';
                    uploadPercentage.textContent = '0%';
                    fileInput.value = '';
                }, 2000);

            } catch (error) {
                console.error('Upload error:', error);
                uploadStatus.textContent = 'Upload failed';
                alert('Failed to upload file. Please try again.');
            }
        }
    });
}

// Store all files globally
let allFiles = [];

// Main initialization function
function initializeApp() {
    // Get UI elements with null checks
    const elements = {
        loadingScreen: document.getElementById('loading-screen'),
        browseButton: document.getElementById('browse-files'),
        fileInput: document.getElementById('file-input'),
        uploadProgress: document.getElementById('upload-progress'),
        progressBar: document.getElementById('progress-bar'),
        uploadStatus: document.getElementById('upload-status'),
        uploadPercentage: document.getElementById('upload-percentage'),
        searchInput: document.getElementById('fileSearch'),
        scrollContainer: document.getElementById('toolsScroll'),
        logoutForm: document.querySelector('form[action="/logout"]')
    };

    // Initialize file upload
    if (elements.browseButton && elements.fileInput) {
        // Ensure the browse button triggers the file input
        elements.browseButton.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            elements.fileInput.click();
        };

        // File selection handler
        elements.fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;

            for (const file of files) {
                // Validate file type
                const fileExt = file.name.split('.').pop().toLowerCase();
                if (!['docx', 'pdf'].includes(fileExt)) {
                    alert('Only .docx and .pdf files are supported');
                    continue;
                }

                // Show upload progress
                elements.uploadProgress.classList.remove('hidden');
                elements.uploadStatus.textContent = `Uploading ${file.name}...`;
                
                try {
                    const formData = new FormData();
                    formData.append('file', file);

                    const response = await fetch('/upload', {
                        method: 'POST',
                        body: formData,
                        credentials: 'same-origin' // Include cookies for authentication
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'Upload failed');
                    }

                    const result = await response.json();

                    // Update UI for success
                    elements.progressBar.style.width = '100%';
                    elements.uploadPercentage.textContent = '100%';
                    elements.uploadStatus.textContent = 'Upload complete!';

                    // Refresh file list
                    if (typeof loadFiles === 'function') {
                        loadFiles();
                    }

                    // Reset form after delay
                    setTimeout(() => {
                        elements.uploadProgress.classList.add('hidden');
                        elements.progressBar.style.width = '0%';
                        elements.uploadPercentage.textContent = '0%';
                        elements.fileInput.value = '';
                    }, 2000);

                } catch (error) {
                    console.error('Upload error:', error);
                    elements.uploadStatus.textContent = 'Upload failed: ' + error.message;
                    alert('Failed to upload file: ' + error.message);
    }
            }
        });
    }

    // Initialize other components
    if (document.getElementById('drop-zone')) {
        initializeDropZone();
    }

    if (elements.searchInput) {
        initializeSearch(elements.searchInput);
    }
    
    // Function to initialize drag & drop functionality
    function initializeDropZone() {
        const dropZone = document.getElementById('drop-zone');
        
        if (!dropZone) return;
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });
        
        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, highlight, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, unhighlight, false);
        });
        
        function highlight() {
            dropZone.classList.add('border-primary', 'bg-primary-50');
        }
        
        function unhighlight() {
            dropZone.classList.remove('border-primary', 'bg-primary-50');
        }
        
        // Handle file drop
        dropZone.addEventListener('drop', function(e) {
            const files = e.dataTransfer.files;
            if (files.length > 0 && elements.fileInput) {
                elements.fileInput.files = files;
                for (const file of files) {
                    handleFileUpload(file, elements);
                }
            }
        });
    }

    if (elements.scrollContainer) {
        initializeScrolling(elements.scrollContainer);
    }

    // Initialize navigation buttons
    initializeNavigation();
    
    // Add logout handler if form exists
    if (elements.logoutForm) {
        elements.logoutForm.addEventListener('submit', handleLogout);
    }
    
    // Load files if the file list exists
    if (document.getElementById('fileList')) {
        loadFiles();
    }
}

// Single DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', initializeApp);

// File Management Functions
function loadFiles() {
    fetch('/files')
        .then(response => response.json())
        .then(files => {
            allFiles = files; // Store files globally
            renderFiles(files);
        })
        .catch(error => console.error('Error loading files:', error));
}

function renderFiles(files) {
    const fileList = document.getElementById('fileList');
    const fileLibrary = document.getElementById('fileLibrary');
    const emptyState = document.querySelector('.text-center.py-16');

    if (!fileList || !fileLibrary || !emptyState) return;

    if (files.length > 0) {
        fileLibrary.classList.remove('hidden');
        emptyState.classList.add('hidden');
        fileList.innerHTML = files.map(file => createFileRow(file)).join('');
    } else {
        fileLibrary.classList.add('hidden');
        emptyState.classList.remove('hidden');
    }
}

function createFileRow(file) {
    return `
        <div class="grid grid-cols-12 items-center py-3 hover:bg-gray-50 rounded-lg">
            <div class="col-span-5 flex items-center">
                <svg class="h-5 w-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                </svg>
                ${file.name}
            </div>
            <div class="col-span-2">${file.upload_date}</div>
            <div class="col-span-2">${file.file_type.toUpperCase()}</div>
            <div class="col-span-3 flex space-x-2">
                <button onclick="previewFile(${file.id}, '${file.name}')" 
                        class="text-blue-600 hover:text-blue-800 font-medium">
                    Preview
                </button>
                <a href="/edit/${file.id}" 
                   class="text-blue-600 hover:text-blue-800 font-medium">
                    Edit
                </a>
                <a href="/download/${file.id}" 
                   class="text-green-600 hover:text-green-800 font-medium">
                    Download
                </a>
                <button onclick="deleteFile(${file.id})" 
                        class="text-red-600 hover:text-red-800 font-medium">
                    Delete
                </button>
            </div>
        </div>
    `;
}

function searchFiles(searchTerm) {
    const filteredFiles = allFiles.filter(file => {
        const searchString = searchTerm.toLowerCase();
        return (
            file.name.toLowerCase().includes(searchString) ||
            file.file_type.toLowerCase().includes(searchString) ||
            file.upload_date.toLowerCase().includes(searchString)
        );
    });
    renderFiles(filteredFiles);
}

function initializeSearch(searchInput) {
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchFiles(e.target.value);
            }, 300);
        });
    }
}

function initializeNavigation() {
    ['build-nav-btn', 'build-files-btn'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', handleNavigation);
        }
    });
}

function handleNavigation(e) {
    e.preventDefault();
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.classList.remove('hidden');
    loadingScreen.classList.add('flex');
    
    setTimeout(() => {
        window.location.href = this.getAttribute('href');
    }, 1500);
}

async function handleFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.docx')) {
        alert('Please upload only DOCX files');
        fileInput.value = '';
        return;
    }

    // Show progress
    uploadProgress.classList.remove('hidden');
    uploadStatus.textContent = 'Converting document...';
    progressBar.style.width = '0%';

    // Create FormData
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Upload failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name.replace('.docx', '.pdf');
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Update progress
        progressBar.style.width = '100%';
        uploadStatus.textContent = 'Conversion complete!';
        
        // Reset form after 2 seconds
        setTimeout(() => {
            uploadProgress.classList.add('hidden');
            progressBar.style.width = '0%';
            fileInput.value = '';
        }, 2000);

    } catch (error) {
        console.error('Error:', error);
        uploadStatus.textContent = 'Conversion failed. Please try again.';
        uploadStatus.classList.add('text-red-500');
    }
}

// Preview and Delete Functions
async function deleteFile(fileId) {
    if (!confirm('Are you sure you want to delete this file?')) {
        return;
    }

    try {
        const response = await fetch(`/delete/${fileId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Delete failed');
        }

        // Refresh the file list
        loadFiles();
        
    } catch (error) {
        console.error('Error deleting file:', error);
        alert('Failed to delete file. Please try again.');
    }
}

function previewFile(fileId) {
    fetch(`/api/preview/${fileId}`)
        .then(response => response.blob())
        .then(blob => {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        })
        .catch(error => {
            console.error('Error previewing file:', error);
            alert('Error previewing file');
        });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('JavaScript loaded successfully');
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadProgress = document.getElementById('uploadProgress');
    let progressBar = null;
    
    if(uploadProgress){
        progressBar = uploadProgress.querySelector('.bg-teal-600');
    }

    const uploadStatus = document.getElementById('uploadStatus');

    // Handle file selection - add null check
    if (fileInput) {
        fileInput.addEventListener('change', handleFileUpload);
    }

    // Handle form submit - add null check
    if (uploadForm) {
        uploadForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleFileUpload();
        });
    }

    // Handle drag and drop
    if (uploadForm) {
        uploadForm.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadForm.classList.add('border-teal-500', 'bg-teal-50');
        });

        uploadForm.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadForm.classList.remove('border-teal-500', 'bg-teal-50');
        });

        uploadForm.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadForm.classList.remove('border-teal-500', 'bg-teal-50');
        
            const files = e.dataTransfer.files;
            if (files.length && fileInput) {
                fileInput.files = files;
                handleFileUpload();
            }
        });
    }

    async function handleFileUpload() {
        const file = fileInput.files[0];
        if (!file) return;

        // Validate file type
        if (!file.name.endsWith('.docx')) {
            alert('Please upload only DOCX files');
            fileInput.value = '';
            return;
        }

        // Show progress
        uploadProgress.classList.remove('hidden');
        uploadStatus.textContent = 'Converting document...';
        progressBar.style.width = '0%';

        // Create FormData
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            
            // Create download link
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name.replace('.docx', '.pdf');
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            // Update progress
            progressBar.style.width = '100%';
            uploadStatus.textContent = 'Conversion complete!';
            
            // Reset form after 2 seconds
            setTimeout(() => {
                uploadProgress.classList.add('hidden');
                progressBar.style.width = '0%';
                fileInput.value = '';
            }, 2000);

        } catch (error) {
            console.error('Error:', error);
            uploadStatus.textContent = 'Conversion failed. Please try again.';
            uploadStatus.classList.add('text-red-500');
        }
    }

    const scrollContainer = document.getElementById('toolsScroll');
    let content = null;
    if (scrollContainer) {
        content = scrollContainer.querySelector('.flex');
    }

    let scrollInterval;
    let isHovered = false;
    const scrollSpeed = 1; // Pixels per frame
    const scrollDelay = 3000; // Delay before auto-scroll starts (3 seconds)

    // Clone items for infinite scroll if content exists
    if (content && content.children && content.children.length) {
        const items = content.children;
        [...items].forEach(item => {
            const clone = item.cloneNode(true);
            content.appendChild(clone);
        });
    }

    function startAutoScroll() {
        if (!isHovered && scrollContainer && content) {
            scrollInterval = setInterval(() => {
                if (scrollContainer.scrollLeft >= content.offsetWidth / 2) {
                    // Reset to start when reaching the cloned set
                    scrollContainer.scrollLeft = 0;
                } else {
                    scrollContainer.scrollLeft += scrollSpeed;
                }
            }, 50);
        }
    }

    function stopAutoScroll() {
        if (scrollInterval) {
            clearInterval(scrollInterval);
        }
    }

    // Start auto-scroll after initial delay only if elements exist
    if (scrollContainer && content) {
        setTimeout(startAutoScroll, scrollDelay);
    }

    // Update hover handlers to ensure smooth transition if scrollContainer exists
    if (scrollContainer) {
        scrollContainer.addEventListener('mouseenter', () => {
            isHovered = true;
            stopAutoScroll();
        });

        scrollContainer.addEventListener('mouseleave', () => {
            isHovered = false;
            // Check position before restarting
            if (content && scrollContainer.scrollLeft >= content.offsetWidth / 2) {
                scrollContainer.scrollLeft = 0;
            }
            startAutoScroll();
        });
    }

    // Update manual scroll handling if scrollContainer exists
    if (scrollContainer) {
        scrollContainer.addEventListener('wheel', (e) => {
            if (isHovered) {
                e.preventDefault();
                scrollContainer.scrollLeft += e.deltaY;
                // Check for loop point during manual scroll
                if (content && scrollContainer.scrollLeft >= content.offsetWidth / 2) {
                    scrollContainer.scrollLeft = 0;
                }
            }
        });

        // Update touch events
        let touchStart = 0;
        scrollContainer.addEventListener('touchstart', (e) => {
            touchStart = e.touches[0].pageX;
            stopAutoScroll();
        });

        scrollContainer.addEventListener('touchend', () => {
            if (!isHovered) {
                if (content && scrollContainer.scrollLeft >= content.offsetWidth / 2) {
                    scrollContainer.scrollLeft = 0;
                }
                setTimeout(startAutoScroll, 1000);
            }
        });

        scrollContainer.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const diff = touchStart - touch.pageX;
            scrollContainer.scrollLeft += diff;
            touchStart = touch.pageX;
        });
    }

    // Add Build button click handler
    const buildNavBtn = document.getElementById('build-nav-btn');
    if (buildNavBtn) {
        buildNavBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const loadingScreen = document.getElementById('loading-screen');
            
            // Show loading screen if it exists
            if (loadingScreen) {
                loadingScreen.classList.remove('hidden');
                loadingScreen.classList.add('flex');
            }
            
            // Simulate loading time then navigate
            setTimeout(() => {
                window.location.href = this.getAttribute('href');
            }, 1500); // 1.5 second delay
        });
    }

    // Also add the same functionality to the Build Files card
    const buildFilesBtn = document.getElementById('build-files-btn');
    if (buildFilesBtn) {
        buildFilesBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const loadingScreen = document.getElementById('loading-screen');
            
            // Show loading screen if it exists
            if (loadingScreen) {
                loadingScreen.classList.remove('hidden');
                loadingScreen.classList.add('flex');
            }
            
            // Simulate loading time then navigate
            setTimeout(() => {
                window.location.href = this.getAttribute('href');
            }, 1500); // 1.5 second delay
        });
    }

    // Search functionality-------------------------------------------------------------------------------
    let allFiles = []; // Store all files for filtering

    function loadFiles() {
        fetch('/files')
            .then(response => response.json())
            .then(files => {
                allFiles = files; // Store all files
                renderFiles(files);
            });
    }

    function renderFiles(files) {
        const fileList = document.getElementById('fileList');
        const fileLibrary = document.getElementById('fileLibrary');
        const emptyState = document.querySelector('.text-center.py-16');

        if (files.length > 0) {
            fileLibrary.classList.remove('hidden');
            emptyState.classList.add('hidden');
            fileList.innerHTML = files.map(file => `
                <div class="grid grid-cols-12 items-center py-3 hover:bg-gray-50">
                    <div class="col-span-6 flex items-center">
                        <svg class="h-5 w-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                        </svg>
                        ${file.name}
                    </div>
                    <div class="col-span-2">${file.file_type.toUpperCase()}</div>
                    <div class="col-span-2">${file.upload_date}</div>
                    <div class="col-span-2 flex space-x-2">
                        <button onclick="editFile(${file.id})" 
                                class="text-blue-600 hover:text-blue-800">
                            Edit
                        </button>
                        <button onclick="downloadFile(${file.id})" 
                                class="text-green-600 hover:text-green-800">
                            Download
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    // Load files when page loads
    document.addEventListener('DOMContentLoaded', loadFiles);

    // Add this to your DOMContentLoaded event listener
    document.addEventListener('DOMContentLoaded', () => {
        // ...existing code...

        // Add search functionality
        const searchInput = document.getElementById('fileSearch');
        searchInput.addEventListener('input', (e) => {
            searchFiles(e.target.value);
        });

        // Add debouncing to prevent too many renders
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchFiles(e.target.value);
            }, 300);
        });

        loadFiles();
    });

    async function deleteFile(fileId) {
        if (!confirm('Are you sure you want to delete this file?')) {
            return;
        }

        try {
            const response = await fetch(`/delete/${fileId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Delete failed');
            }

            loadFiles();
        } catch (error) {
            console.error('Error deleting file:', error);
            alert('Failed to delete file. Please try again.');
        }
    }

    function previewFile(fileId, fileName) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('previewModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'previewModal';
            modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50';
            document.body.appendChild(modal);
        }

        // Update modal content
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center p-4 border-b">
                    <h3 class="text-lg font-semibold text-gray-900">${fileName}</h3>
                    <button onclick="closePreview()" class="text-gray-500 hover:text-gray-700">
                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="flex-1 overflow-auto p-4">
                    <iframe src="/preview/${fileId}" class="w-full h-full border-0"></iframe>
                </div>
            </div>
        `;

        // Show modal
        modal.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
    }

    function closePreview() {
        const modal = document.getElementById('previewModal');
        if (modal) {
            modal.remove();
            document.body.classList.remove('overflow-hidden');
        }
    }

    // Logout function
    function handleLogout(event) {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.remove('hidden');
            loadingScreen.classList.add('flex');
        }
        
        // Show loading for 1 second before actual logout
        setTimeout(() => {
            window.location.href = '/logout';
        }, 1000);
        
        event.preventDefault();
    }

    // Add logout handler when DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
        const logoutForm = document.querySelector('form[action="/logout"]');
        if (logoutForm) {
            logoutForm.addEventListener('submit', handleLogout);
        }
    });

    // Main initialization when DOM is loaded
    document.addEventListener('DOMContentLoaded', function() {
        // Get elements with proper null checks
        const elements = {
            uploadForm: document.getElementById('uploadForm'),
            fileInput: document.getElementById('file-input'),
            browseButton: document.getElementById('browse-files'),
            uploadProgress: document.getElementById('upload-progress'),
            progressBar: document.getElementById('progress-bar'),
            uploadStatus: document.getElementById('upload-status'),
            uploadPercentage: document.getElementById('upload-percentage'),
            searchInput: document.getElementById('fileSearch'),
            logoutForm: document.querySelector('form[action="/logout"]')
        };

        // Initialize file upload if elements exist
        if (elements.browseButton && elements.fileInput) {
            initializeFileUpload(elements);
        }

        // Initialize search if element exists
        if (elements.searchInput) {
            initializeSearch(elements.searchInput);
        }

        // Initialize logout handler
        if (elements.logoutForm) {
            elements.logoutForm.addEventListener('submit', handleLogout);
        }

        // Load files if needed
        loadFiles();
    });

    // Helper function to initialize file upload
    function initializeFileUpload(elements) {
        const { browseButton, fileInput, uploadProgress, progressBar, uploadStatus, uploadPercentage } = elements;

        browseButton.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files.length) return;

            for (const file of files) {
                await handleFileUpload(file, elements);
            }
        });
    }

    // Helper function to handle file upload
    async function handleFileUpload(file, elements) {
        const { uploadProgress, progressBar, uploadStatus, uploadPercentage, fileInput } = elements;
        
        const fileExt = file.name.split('.').pop().toLowerCase();
        if (!['docx', 'pdf'].includes(fileExt)) {
            alert('Only .docx and .pdf files are supported');
            return;
        }

        if (uploadProgress) uploadProgress.classList.remove('hidden');
        if (uploadStatus) uploadStatus.textContent = `Uploading ${file.name}...`;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Upload failed');

            updateUploadProgress(elements, '100%', 'Upload complete!');
            if (typeof loadFiles === 'function') loadFiles();

            setTimeout(() => resetUploadForm(elements), 2000);

        } catch (error) {
            console.error('Upload error:', error);
            if (uploadStatus) uploadStatus.textContent = 'Upload failed';
            alert('Failed to upload file. Please try again.');
        }
    }

    // Helper function to update upload progress
    function updateUploadProgress(elements, progress, status) {
        const { progressBar, uploadPercentage, uploadStatus } = elements;
        
        if (progressBar) progressBar.style.width = progress;
        if (uploadPercentage) uploadPercentage.textContent = progress;
        if (uploadStatus) uploadStatus.textContent = status;
    }

    // Helper function to reset upload form
    function resetUploadForm(elements) {
        const { uploadProgress, progressBar, uploadPercentage, fileInput } = elements;
        
        if (uploadProgress) uploadProgress.classList.add('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (uploadPercentage) uploadPercentage.textContent = '0%';
        if (fileInput) fileInput.value = '';
    }

});


