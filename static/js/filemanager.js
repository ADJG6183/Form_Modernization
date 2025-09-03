class FileManager {
    constructor() {
        this.files = [];
        this.initializeListeners();
        this.loadFiles();
    }

    initializeListeners() {
        const searchInput = document.getElementById('fileSearch');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.searchFiles(e.target.value);
                }, 300);
            });
        }
    }

    async loadFiles() {
        try {
            const response = await fetch('/files');
            const files = await response.json();
            this.files = files;
            this.renderFiles(files);
        } catch (error) {
            console.error('Error loading files:', error);
        }
    }

    renderFiles(files) {
        const fileList = document.getElementById('fileList');
        const fileLibrary = document.getElementById('fileLibrary');
        const emptyState = document.getElementById('emptyState');

        if (!fileList || !fileLibrary || !emptyState) return;

        if (files.length > 0) {
            fileLibrary.classList.remove('hidden');
            emptyState.classList.add('hidden');
            fileList.innerHTML = files.map(file => this.createFileRow(file)).join('');
        } else {
            fileLibrary.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
    }

    createFileRow(file) {
        return `
            <div class="grid grid-cols-12 items-center py-3 hover:bg-gray-50 rounded-lg" data-file-id="${file.id}">
                <div class="col-span-5 flex items-center">
                    <svg class="h-5 w-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                    ${file.name}
                </div>
                <div class="col-span-3">${file.upload_date}</div>
                <div class="col-span-2">${file.file_type.toUpperCase()}</div>
                <div class="col-span-2 flex space-x-2">
                    <button onclick="fileManager.previewFile(${file.id}, '${file.name}')" 
                            class="text-blue-600 hover:text-blue-800 font-medium">
                        Preview
                    </button>
                    <button onclick="fileManager.downloadFile(${file.id})" 
                            class="text-green-600 hover:text-green-800 font-medium">
                        Download
                    </button>
                    <button onclick="fileManager.deleteFile(${file.id})" 
                            class="text-red-600 hover:text-red-800 font-medium">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }

    searchFiles(searchTerm) {
        const filteredFiles = this.files.filter(file => {
            const searchString = searchTerm.toLowerCase();
            return (
                file.name.toLowerCase().includes(searchString) ||
                file.file_type.toLowerCase().includes(searchString) ||
                file.upload_date.toLowerCase().includes(searchString)
            );
        });
        this.renderFiles(filteredFiles);
    }

    static async previewFile(fileId, fileName) {
        try {
            fetch(`/preview/${fileId}`)
                .then(response => response.blob())
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank');
                })
                .catch(error => {
                    console.error('Error previewing file:', error);
                    alert('Error previewing file');
                });
        } catch (error) {
            console.error('Error previewing file:', error);
            alert('Failed to preview file. Please try again.');
        }
    }

    static async downloadFile(fileId) {
        window.location.href = `/api/download/${fileId}`;
    }

    static async deleteFile(fileId) {
        if (!confirm('Are you sure you want to delete this file?')) return;

        try {
            fetch(`/api/delete/${fileId}`, {
                method: 'DELETE',
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Refresh the page to show updated file list
                    location.reload();
                } else {
                    alert('Error deleting file');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('Error deleting file');
            });
        } catch (error) {
            console.error('Error deleting file:', error);
            alert('Failed to delete file. Please try again.');
        }
    }

    uploadFiles(files) {
        const formData = new FormData();
        for (let file of files) {
            formData.append('files[]', file);
        }

        const progressBar = document.getElementById('progress-bar');
        const uploadStatus = document.getElementById('upload-status');
        const uploadPercentage = document.getElementById('upload-percentage');
        const uploadProgress = document.getElementById('upload-progress');

        uploadProgress.style.display = 'block';

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                uploadStatus.textContent = 'Upload Complete!';
                progressBar.style.width = '100%';
                uploadPercentage.textContent = '100%';
                // Refresh the page after successful upload
                setTimeout(() => location.reload(), 1000);
            } else {
                throw new Error('Upload failed');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            uploadStatus.textContent = 'Upload Failed';
            alert('Error uploading files');
        });
    }

    static async cleanupFiles() {
        if (confirm('Are you sure you want to delete ALL files? This action cannot be undone!')) {
            fetch('/api/cleanup', {
                method: 'POST',
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('All files have been cleaned up successfully');
                    location.reload();
                } else {
                    throw new Error(data.error || 'Cleanup failed');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('Error cleaning up files: ' + error.message);
            });
        }
    }
}

function openInEditor(fileId) {
    console.log(`Opening file ID ${fileId} in form editor`);
    
    if (!fileId) {
        console.error('Invalid file ID provided to openInEditor');
        alert('Could not open editor: Invalid file ID');
        return;
    }
    
    // Clear any cached PDF data to ensure we load the latest version
    localStorage.removeItem('pdfUrl');
    localStorage.removeItem('pdfFields');
    
    // Set flag to indicate we're opening a specific file
    localStorage.setItem('openingFileId', fileId);

    // Show loading indicator
    const loadingElement = document.createElement('div');
    loadingElement.id = 'editor-loading-overlay';
    loadingElement.style.position = 'fixed';
    loadingElement.style.top = '0';
    loadingElement.style.left = '0';
    loadingElement.style.width = '100%';
    loadingElement.style.height = '100%';
    loadingElement.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    loadingElement.style.display = 'flex';
    loadingElement.style.justifyContent = 'center';
    loadingElement.style.alignItems = 'center';
    loadingElement.style.zIndex = '9999';
    loadingElement.innerHTML = '<div style="text-align: center;"><div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid #019fac; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 10px auto;"></div><p>Opening form editor...</p></div>';
    
    // Add animation style
    const styleElement = document.createElement('style');
    styleElement.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
    document.head.appendChild(styleElement);
    document.body.appendChild(loadingElement);
    
    // First, check if the file exists by making a GET request
    fetch(`/api/check-file-exists/${fileId}`)
        .then(response => response.json())
        .then(data => {
            if (data.exists) {
                // File exists, proceed to edit form
                console.log(`File ${fileId} exists, navigating to edit page`);
                window.location.href = `/edit-form/${fileId}?fromSavedFiles=true`;
            } else {
                // File doesn't exist, show error
                console.error(`File ${fileId} not found`);
                document.getElementById('editor-loading-overlay').remove();
                alert('Could not open editor: File not found');
            }
        })
        .catch(error => {
            console.error('Error checking file existence:', error);
            // Remove loading overlay
            const overlay = document.getElementById('editor-loading-overlay');
            if (overlay) overlay.remove();
            alert('Error checking file status. Please try again.');
        });
}

function openInDesign(fileId) {
    console.log(`Opening file ID ${fileId} in design editor`);
    
    // Clear any cached PDF data to ensure we load the latest version
    localStorage.removeItem('pdfUrl');
    localStorage.removeItem('pdfFields');
    
    // Set flag to indicate we're opening a specific file
    localStorage.setItem('openingFileId', fileId);
    
    // Navigate to the design page
    window.location.href = `/design/${fileId}`;
}

function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Redirect to design page with file ID
            window.location.href = `/design/${data.file_id}`;
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error uploading file');
    });
}

function downloadFilledForm(fileId) {
    console.log(`Downloading filled form with ID ${fileId}`);
    // Create a download link and trigger it
    const link = document.createElement('a');
    link.href = `/serve-filled-form/${fileId}?download=true`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function previewPDF(fileId, source = 'created') {
    console.log(`Previewing ${source} PDF with ID ${fileId}`);
    let url;
    
    if (source === 'uploaded') {
        url = `/serve-pdf/${fileId}?source=uploaded`;
    } else if (source === 'created') {
        url = `/serve-pdf/${fileId}?source=created`;
    } else if (source === 'filled') {
        url = `/serve-filled-form/${fileId}`;
    } else {
        console.error('Invalid source type for preview');
        return;
    }
    
    // Open in Simple Browser or PDF viewer
    window.open(url, '_blank');
}

// Initialize file manager
const fileManager = new FileManager();

// Make functions globally available
window.previewFile = FileManager.previewFile;
window.downloadFile = FileManager.downloadFile;
window.deleteFile = FileManager.deleteFile;
window.cleanupFiles = FileManager.cleanupFiles;
window.openInEditor = openInEditor;
window.openInDesign = openInDesign;
window.downloadFilledForm = downloadFilledForm;
window.previewPDF = previewPDF;