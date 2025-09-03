// Make uploadFile function available globally
let uploadFile;

document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const browseBtn = document.getElementById('browse-files');
    const fileInput = document.getElementById('file-input');
    const selectedFileName = document.getElementById('selected-file-name');
    const loadingOverlay = document.getElementById('loading-overlay');
    
    if (!browseBtn || !fileInput) {
        console.error('Required upload elements not found');
        return;
    }
    
    // Open file picker when browse button is clicked
    browseBtn.addEventListener('click', function() {
        fileInput.click();
    });
    
    // When a file is selected
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Display file name if element exists
        if (selectedFileName) {
            selectedFileName.textContent = file.name;
        }
        
        // Upload the file automatically
        uploadFile(file);
    });
    
    // Handle file upload with loading animation
    uploadFile = async function(file) {
        // Show loading overlay
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
            console.log('Loading overlay shown');
        } else {
            console.warn('Loading overlay element not found');
        }
        
        // Create form data
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            console.log('Starting upload...');
            
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            console.log('Upload response received', response.status);
            
            // Check if response is OK
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }
            
            // Check for JSON response
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error('Server returned non-JSON response:', text);
                throw new Error('Server returned invalid response format');
            }
            
            // Parse JSON response
            const data = await response.json();
            console.log('Response data:', data);
            
            if (data.success && data.file_id) {
                // Delay redirect slightly to ensure loading animation is seen
                console.log('Upload successful, redirecting to:', data.redirect_url);
                
                // Keep loading overlay visible during redirect
                setTimeout(() => {
                    window.location.href = data.redirect_url || `/design/${data.file_id}`;
                }, 500); // Short delay for better UX
            } else {
                throw new Error(data.error || 'Unknown upload error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert(`Upload failed: ${error.message}`);
            
            // Hide loading overlay on error
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
            }
        }
        // Note: We don't hide overlay on success to maintain it during redirect
    }
});