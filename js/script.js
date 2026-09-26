/* ============================================
   RuDao V2 - Book Website Interactions
   Sections: Hero, Concept, Book, Contents (16 ch),
   Editions, Pillars, Principles, Compare, Lineage+Quotes,
   Author, Pre-Order
   ============================================ */

(function() {
    'use strict';

    // ============================================
    // Nav scroll effect
    // ============================================
    const nav = document.getElementById('nav');
    const handleScroll = () => {
        if (window.scrollY > 30) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // ============================================
    // Mobile menu toggle
    // ============================================
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.querySelector('.nav-links');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navToggle.classList.toggle('open');
            navLinks.classList.toggle('open');
        });
        // Close menu on link click
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navToggle.classList.remove('open');
                navLinks.classList.remove('open');
            });
        });
    }

    // ============================================
    // Scroll reveal animation
    // ============================================
    const revealTargets = [
        '.section-head',
        '.concept-card', '.concept-divider', '.quote-block',
        '.book-art', '.book-info',
        '.toc-part-header', '.toc-chapter',
        '.edition-card',
        '.pillar',
        '.principle',
        '.compare-table-wrap', '.compare-note',
        '.lineage-card', '.lineage-intro', '.key-quote', '.quotes-title',
        '.author-portrait', '.author-info', '.author-credentials',
        '.preorder-art', '.preorder-content'
    ];

    const elements = document.querySelectorAll(revealTargets.join(','));
    elements.forEach((el, i) => {
        el.classList.add('reveal');
        el.style.transitionDelay = `${Math.min(i * 30, 200)}ms`;
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.12,
            rootMargin: '0px 0px -60px 0px'
        });

        elements.forEach(el => observer.observe(el));
    } else {
        elements.forEach(el => el.classList.add('visible'));
    }

    // ============================================
    // Hero calligraphy parallax
    // ============================================
    const heroCalligraphy = document.querySelector('.hero-calligraphy');
    const hero = document.querySelector('.hero');
    if (heroCalligraphy && hero && window.matchMedia('(min-width: 860px)').matches) {
        let ticking = false;
        const updateParallax = () => {
            const scrolled = window.scrollY;
            const heroHeight = hero.offsetHeight;
            if (scrolled < heroHeight) {
                const progress = scrolled / heroHeight;
                const translateY = scrolled * 0.3;
                const scale = 1 + progress * 0.15;
                const opacity = 0.08 + progress * 0.04;
                heroCalligraphy.style.transform =
                    `translateY(${translateY}px) rotate(-2deg) scale(${scale})`;
                heroCalligraphy.style.opacity = opacity;
            }
            ticking = false;
        };
        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(updateParallax);
                ticking = true;
            }
        }, { passive: true });
    }

    // ============================================
    // Book cover 3D tilt on mouse move
    // ============================================
    const bookCover = document.querySelector('.book-cover-real');
    if (bookCover && window.matchMedia('(min-width: 860px)').matches) {
        const bookArt = document.querySelector('.book-art');
        bookArt.addEventListener('mousemove', (e) => {
            const rect = bookArt.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            bookCover.style.transform =
                `rotateY(${-14 + x * 12}deg) rotateX(${2 - y * 8}deg)`;
        });
        bookArt.addEventListener('mouseleave', () => {
            bookCover.style.transform = 'rotateY(-14deg) rotateX(2deg)';
        });
    }

    // ============================================
    // Pre-order form
    // ============================================
    const preorderForm = document.getElementById('preorderForm');
    const preorderNote = document.getElementById('preorderNote');
    if (preorderForm) {
        preorderForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = preorderForm.querySelector('input[type="email"]');
            const value = email.value.trim();
            const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

            if (!validEmail) {
                email.style.borderColor = 'var(--vermillion)';
                email.focus();
                return;
            }

            // Success state
            const button = preorderForm.querySelector('button');
            const originalText = button.textContent;
            button.textContent = '\u2713 Subscribed';
            button.disabled = true;
            button.style.background = 'var(--vermillion)';
            email.disabled = true;

            if (preorderNote) {
                preorderNote.textContent = `Thank you, ${value.split('@')[0]}. We'll notify you when the book is ready.`;
                preorderNote.style.color = 'var(--vermillion)';
                preorderNote.style.fontWeight = '500';
            }

            // Reset after 6 seconds (demo only)
            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
                button.style.background = '';
                email.disabled = false;
                email.value = '';
                email.style.borderColor = '';
                if (preorderNote) {
                    preorderNote.textContent = 'Bilingual edition \u00B7 Hardcover & e-book \u00B7 Worldwide shipping';
                    preorderNote.style.color = '';
                    preorderNote.style.fontWeight = '';
                }
            }, 6000);
        });
    }

    // ============================================
    // Smooth scroll offset for fixed nav
    // ============================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                const navHeight = nav.offsetHeight;
                const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight + 1;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // ============================================
    // Subtle ink wash drift on hero background
    // ============================================
    const heroBg = document.querySelector('.hero-bg');
    if (heroBg) {
        let frame = 0;
        const animateBg = () => {
            frame += 0.005;
            const x1 = Math.sin(frame) * 0.5;
            const y1 = Math.cos(frame * 0.7) * 0.3;
            const x2 = Math.cos(frame * 0.8) * 0.4;
            const y2 = Math.sin(frame * 1.1) * 0.5;
            heroBg.style.background = `
                radial-gradient(ellipse 80% 60% at ${50 + x1 * 10}% ${30 + y1 * 10}%, rgba(185, 146, 58, 0.08), transparent 70%),
                radial-gradient(ellipse 50% 40% at ${80 + x2 * 8}% ${80 + y2 * 8}%, rgba(169, 50, 38, 0.06), transparent 70%),
                var(--paper)
            `;
            requestAnimationFrame(animateBg);
        };
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            requestAnimationFrame(animateBg);
        }
    }

    console.log('%c\u5112\u9053 \u00B7 RuDao', 'font-family: serif; font-size: 24px; color: #a93226; padding: 8px 0;');
    console.log('%cBeyond The Art of War \u2014 The Confucian Co-opetition Way', 'font-style: italic; color: #6b6b6b;');
    console.log('%c3 Parts \u00B7 16 Chapters \u2014 RuDao.us', 'color: #c9a961;');
})();