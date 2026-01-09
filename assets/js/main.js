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

  // Enhanced Intersection Observer for scroll animations
  const observerOptions = {
    threshold: 0.15,
    rootMargin: '0px 0px -100px 0px'
  };

  const scrollObserver = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Remove observer after animation to improve performance
        scrollObserver.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Add scroll animation classes to elements
  document.querySelectorAll('.app-card, .feature-card, .tech-badge, .tech-stack, .apps-showcase, .feature-section, .contact-info').forEach((el, index) => {
    // Alternate animation directions for visual interest
    if (index % 3 === 0) {
      el.classList.add('scroll-fade-in');
    } else if (index % 3 === 1) {
      el.classList.add('scroll-fade-left');
    } else {
      el.classList.add('scroll-fade-right');
    }
    scrollObserver.observe(el);
  });

  // Legacy support for elements without classes
  const legacyObserver = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Observe legacy elements
  document.querySelectorAll('.app-card, .feature-card, .tech-badge').forEach(el => {
    if (!el.classList.contains('scroll-fade-in') && 
        !el.classList.contains('scroll-fade-left') && 
        !el.classList.contains('scroll-fade-right')) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1), transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
      legacyObserver.observe(el);
    }
  });

  // Contact link animations
  document.querySelectorAll('.contact-link').forEach(link => {
    link.addEventListener('mouseenter', function() {
      this.style.transform = 'translateX(10px) scale(1.02)';
    });
    
    link.addEventListener('mouseleave', function() {
      this.style.transform = 'translateX(0) scale(1)';
    });
  });

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

  // Particle Effects
  initParticles();

  // Console easter egg
  console.log('%c👋 Hey there!', 'color: #00ff00; font-size: 20px; font-weight: bold;');
  console.log('%cInterested in the code? Check out the repository!', 'color: #8b949e; font-size: 12px;');
});

// Particle Effects System
function initParticles() {
  const canvas = document.createElement('canvas');
  canvas.id = 'particles-canvas';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let animationId;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Particle class
  class Particle {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 2 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.5;
      this.speedY = (Math.random() - 0.5) * 0.5;
      this.opacity = Math.random() * 0.5 + 0.2;
      this.life = Math.random() * 100 + 50;
      this.maxLife = this.life;
    }

    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      this.life--;

      // Wrap around edges
      if (this.x < 0) this.x = canvas.width;
      if (this.x > canvas.width) this.x = 0;
      if (this.y < 0) this.y = canvas.height;
      if (this.y > canvas.height) this.y = 0;

      // Reset when life expires
      if (this.life <= 0) {
        this.reset();
      }
    }

    draw() {
      const alpha = (this.life / this.maxLife) * this.opacity;
      ctx.fillStyle = `rgba(0, 255, 0, ${alpha})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();

      // Add glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(0, 255, 0, 0.5)';
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Create particles
  const particles = [];
  const particleCount = Math.min(50, Math.floor((canvas.width * canvas.height) / 15000));

  for (let i = 0; i < particleCount; i++) {
    particles.push(new Particle());
  }

  // Connect nearby particles with lines
  function drawConnections() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 150) {
          const opacity = (1 - distance / 150) * 0.2;
          ctx.strokeStyle = `rgba(0, 255, 0, ${opacity})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  // Animation loop
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    particles.forEach(particle => {
      particle.update();
      particle.draw();
    });

    drawConnections();
    
    animationId = requestAnimationFrame(animate);
  }

  // Start animation
  animate();

  // Pause on tab visibility change for performance
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      cancelAnimationFrame(animationId);
    } else {
      animate();
    }
  });
}

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
