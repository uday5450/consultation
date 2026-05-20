document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('onboarding-form');
    const steps = Array.from(document.querySelectorAll('.form-step'));
    const nextButtons = document.querySelectorAll('.next-step-btn');
    const prevButtons = document.querySelectorAll('.prev-step-btn');
    const progressBar = document.getElementById('progress-bar');
    const stepIndicatorText = document.getElementById('step-indicator-text');
    const successScreen = document.getElementById('success-screen');
    const progressWrapper = document.getElementById('progress-wrapper');
    const errorToast = document.getElementById('error-toast');
    const errorToastMessage = document.getElementById('error-toast-message');
    const submitBtnEl = document.getElementById('submit-btn-el');

    let currentStep = 1;
    const totalSteps = steps.length;

    // Toast Manager
    function showError(message) {
        errorToastMessage.textContent = message;
        errorToast.classList.add('show');
        setTimeout(() => {
            errorToast.classList.remove('show');
        }, 5000);
    }

    // Step Transition and Progress Bar Update
    function updateSteps() {
        steps.forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === currentStep) {
                step.classList.add('active');
            }
        });

        // Update progress bar
        const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
        progressBar.style.width = `${progressPercentage}%`;

        // Update text indicator
        const stepTitles = [
            "Core Information",
            "Business & Investment Profile",
            "Branding Goals & Channels"
        ];
        stepIndicatorText.textContent = `Step ${currentStep} of ${totalSteps}: ${stepTitles[currentStep - 1]}`;
    }

    // Custom form page validation
    function validateStep(stepNum) {
        const stepContainer = document.querySelector(`.form-step[data-step="${stepNum}"]`);
        const requiredInputs = stepContainer.querySelectorAll('[required]');
        let stepValid = true;

        requiredInputs.forEach(input => {
            // Check for plain inputs or select options
            if (!input.value.trim()) {
                input.style.borderColor = '#ff7675';
                stepValid = false;
            } else {
                input.style.borderColor = 'var(--border-color)';
            }
        });

        // Custom validation for step 2 checkboxes (monthly_investment & business_age)
        if (stepNum === 2) {
            const investmentChecked = stepContainer.querySelectorAll('input[name="monthly_investment"]:checked');
            const ageChecked = stepContainer.querySelectorAll('input[name="business_age"]:checked');

            if (investmentChecked.length === 0) {
                showError("Please select at least one monthly investment option.");
                stepValid = false;
            }
            if (ageChecked.length === 0) {
                showError("Please select at least one business age checkbox.");
                stepValid = false;
            }
        }

        if (!stepValid && stepNum !== 2) {
            showError("Please fill out all required fields marked with * before moving to the next step.");
        }

        return stepValid;
    }

    // Reset red borders on input focus
    document.querySelectorAll('.input-control').forEach(input => {
        input.addEventListener('input', () => {
            input.style.borderColor = 'var(--border-color)';
        });
        input.addEventListener('change', () => {
            input.style.borderColor = 'var(--border-color)';
        });
    });

    // Handle next step clicking
    nextButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateStep(currentStep)) {
                if (currentStep < totalSteps) {
                    currentStep++;
                    updateSteps();
                }
            }
        });
    });

    // Handle back buttons clicking
    prevButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentStep > 1) {
                currentStep--;
                updateSteps();
            }
        });
    });

    // Handle Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!validateStep(currentStep)) return;

        // Visual loading feedback
        const originalBtnContent = submitBtnEl.innerHTML;
        submitBtnEl.disabled = true;
        submitBtnEl.innerHTML = '<div class="spinner"></div><span>Submitting...</span>';

        // Extract form values
        const formData = new FormData(form);
        
        // Grab values for checkboxes
        const monthlyInvestment = Array.from(formData.getAll('monthly_investment'));
        const businessAge = Array.from(formData.getAll('business_age'));

        const payload = {
            full_name: formData.get('full_name'),
            contact_number: formData.get('contact_number'),
            business_name: formData.get('business_name'),
            city_state: formData.get('city_state'),
            industry: formData.get('industry'),
            monthly_investment: monthlyInvestment,
            business_age: businessAge,
            team_size: formData.get('team_size'),
            social_profile: formData.get('social_profile') || "",
            website: formData.get('website') || "",
            hear_about_us: formData.get('hear_about_us'),
            biggest_challenge: formData.get('biggest_challenge') || ""
        };

        try {
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                // Success actions
                form.style.display = 'none';
                progressWrapper.style.display = 'none';
                successScreen.style.display = 'block';
            } else {
                throw new Error(result.detail || "Unable to submit your response.");
            }

        } catch (error) {
            console.error('Submission error:', error);
            showError(`Error: ${error.message}`);
            submitBtnEl.disabled = false;
            submitBtnEl.innerHTML = originalBtnContent;
        }
    });

    // Initialize progress bar width
    updateSteps();
});
