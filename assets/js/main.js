// Main JavaScript for ApixDenice Website

document.addEventListener('DOMContentLoaded', function() {
  // Mobile Navigation Toggle
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');

  if (hamburger && navMenu) {
    hamburger.addEventListener('click', function() {
      hamburger.classList.toggle('active');
      navMenu.classList.toggle('active');
    });

    // Close menu when clicking on a link
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
      });
    });
  }

  // Smooth Scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Intersection Observer for scroll animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Observe elements for animation
  document.querySelectorAll('.app-card, .feature-card, .tech-badge').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  });

  // Contact Form Handling
  const contactForm = document.getElementById('contact-form');
  const formStatus = document.getElementById('form-status');

  if (contactForm) {
    contactForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const submitButton = contactForm.querySelector('button[type="submit"]');
      const btnText = submitButton.querySelector('.btn-text');
      const btnLoader = submitButton.querySelector('.btn-loader');
      
      // Show loading state
      btnText.style.display = 'none';
      btnLoader.style.display = 'inline';
      submitButton.disabled = true;
      formStatus.style.display = 'none';

      // Get form data
      const formData = new FormData(contactForm);
      
      // Set reply-to from email field
      const emailField = contactForm.querySelector('#email');
      if (emailField && emailField.value) {
        formData.set('_replyto', emailField.value);
      }
      
      try {
        const response = await fetch(contactForm.action, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          formStatus.textContent = 'Message sent successfully! I\'ll get back to you soon.';
          formStatus.className = 'form-status success';
          formStatus.style.display = 'block';
          contactForm.reset();
        } else {
          throw new Error('Form submission failed');
        }
      } catch (error) {
        formStatus.textContent = 'Oops! There was an error sending your message. Please try again or email me directly.';
        formStatus.className = 'form-status error';
        formStatus.style.display = 'block';
      } finally {
        // Reset button state
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
        submitButton.disabled = false;
      }
    });
  }

  // App Card Click Animation
  document.querySelectorAll('.app-card').forEach(card => {
    card.addEventListener('click', function() {
      const link = this.querySelector('a');
      if (link) {
        link.click();
      }
    });

    // Add ripple effect on click
    card.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      ripple.classList.add('ripple');
      
      this.appendChild(ripple);
      
      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });

  // Typing effect for hero text (if not using CSS animation)
  const typewriterElement = document.querySelector('.typewriter');
  if (typewriterElement && !typewriterElement.textContent.includes('iOS & macOS Developer')) {
    const text = typewriterElement.textContent;
    typewriterElement.textContent = '';
    let i = 0;
    
    function type() {
      if (i < text.length) {
        typewriterElement.textContent += text.charAt(i);
        i++;
        setTimeout(type, 100);
      } else {
        typewriterElement.style.borderRight = 'none';
      }
    }
    
    setTimeout(type, 1000);
  }

  // Parallax effect for hero section
  window.addEventListener('scroll', function() {
    const scrolled = window.pageYOffset;
    const heroSection = document.querySelector('.hero-section');
    if (heroSection) {
      heroSection.style.transform = `translateY(${scrolled * 0.5}px)`;
      heroSection.style.opacity = 1 - scrolled / 500;
    }
  });

  // Add glow effect on hover for tech badges
  document.querySelectorAll('.tech-badge').forEach(badge => {
    badge.addEventListener('mouseenter', function() {
      this.style.textShadow = '0 0 10px var(--primary-green)';
    });
    
    badge.addEventListener('mouseleave', function() {
      this.style.textShadow = 'none';
    });
  });

  // Console easter egg
  console.log('%c👋 Hey there!', 'color: #00ff00; font-size: 20px; font-weight: bold;');
  console.log('%cInterested in the code? Check out the repository!', 'color: #8b949e; font-size: 12px;');
});

// Add ripple effect styles dynamically
const style = document.createElement('style');
style.textContent = `
  .ripple {
    position: absolute;
    border-radius: 50%;
    background: rgba(0, 255, 0, 0.3);
    transform: scale(0);
    animation: ripple-animation 0.6s ease-out;
    pointer-events: none;
  }
  
  @keyframes ripple-animation {
    to {
      transform: scale(4);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
