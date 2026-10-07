/* ============================================
   RuDao V4 - Book Website Interactions
   New: Audiobook intro bar (click-to-play ONLY - no autoplay)
   Sections: AudioBar, Hero, Concept, Book, Contents (16 ch),
   Editions, Pillars, Principles, Compare, Lineage+Quotes,
   Author, Pre-Order
   ============================================ */

(function() {
    'use strict';

    // ============================================
    // Dual Audiobook intro players
    // Audio 1 = English, Audio 2 = Bilingual
    // Playing one pauses the other
    // ============================================

    function setupAudioPlayer(opts) {
        // opts: { suffix, src, label }
        var suffix = opts.suffix;
        var audioBar = document.getElementById('audioIntroBar' + suffix);
        var audio = document.getElementById('introAudio' + suffix);
        var playBtn = document.getElementById('audioPlayBtn' + suffix);
        var iconPlay = playBtn ? playBtn.querySelector('.icon-play') : null;
        var iconPause = playBtn ? playBtn.querySelector('.icon-pause') : null;
        var progressBar = document.getElementById('audioProgressBar' + suffix);
        var progressTrack = document.getElementById('audioProgress' + suffix);
        var timeCurrent = document.getElementById('audioTimeCurrent' + suffix);
        var timeDuration = document.getElementById('audioTimeDuration' + suffix);
        var dismissBtn = document.getElementById('audioDismiss' + suffix);
        var hint = document.getElementById('audioHint' + suffix);

        if (!audio || !playBtn) return null;

        function formatTime(sec) {
            if (isNaN(sec) || sec < 0 || !isFinite(sec)) return '0:00';
            var m = Math.floor(sec / 60);
            var s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function updateUI(playing) {
            if (playing) {
                playBtn.classList.add('playing');
                if (iconPlay) iconPlay.style.display = 'none';
                if (iconPause) iconPause.style.display = 'block';
                if (hint) hint.classList.add('hidden');
            } else {
                playBtn.classList.remove('playing');
                if (iconPlay) iconPlay.style.display = 'block';
                if (iconPause) iconPause.style.display = 'none';
                if (hint) {
                    hint.classList.remove('hidden');
                    hint.textContent = 'Click the red button to play';
                }
            }
        }

        // Get the other player (to pause it when this one plays)
        function pauseOtherPlayer() {
            if (opts.onPlayStart) opts.onPlayStart();
        }

        function toggleAudio() {
            if (audio.paused) {
                pauseOtherPlayer();
                var promise = audio.play();
                if (promise && typeof promise.then === 'function') {
                    promise.then(function() {
                        updateUI(true);
                        playBtn.classList.remove('icon-pulse');
                    }).catch(function(err) {
                        console.log('Audio ' + suffix + ' play blocked:', err && err.name ? err.name : err);
                        playBtn.classList.add('icon-pulse');
                        updateUI(false);
                    });
                } else {
                    updateUI(true);
                }
            } else {
                audio.pause();
                updateUI(false);
            }
        }

        // Set volume
        audio.volume = 0.85;
        audio.load();

        // Play/pause button
        playBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleAudio();
            return false;
        });

        // Progress bar
        audio.addEventListener('timeupdate', function() {
            if (progressBar && audio.duration && isFinite(audio.duration)) {
                progressBar.style.width = (audio.currentTime / audio.duration) * 100 + '%';
            }
            if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
        });

        // Duration
        audio.addEventListener('loadedmetadata', function() {
            if (timeDuration && audio.duration) timeDuration.textContent = formatTime(audio.duration);
        });
        audio.addEventListener('canplaythrough', function() {
            if (timeDuration && audio.duration) timeDuration.textContent = formatTime(audio.duration);
        });

        // Error
        audio.addEventListener('error', function() {
            console.log('Audio ' + suffix + ' failed to load:', audio.currentSrc || audio.src);
            playBtn.style.opacity = '0.5';
            playBtn.style.cursor = 'not-allowed';
        });

        // Ended
        audio.addEventListener('ended', function() {
            updateUI(false);
            if (progressBar) progressBar.style.width = '0%';
            if (timeCurrent) timeCurrent.textContent = '0:00';
            audio.currentTime = 0;
        });

        // State sync
        audio.addEventListener('play', function() {
            // Safety net: never let both players sound at the same time,
            // no matter how playback was triggered.
            pauseOtherPlayer();
            updateUI(true);
            playBtn.classList.remove('icon-pulse');
        });
        audio.addEventListener('pause', function() {
            updateUI(false);
        });

        // Seek
        if (progressTrack) {
            progressTrack.addEventListener('click', function(e) {
                if (!audio.duration || !isFinite(audio.duration)) return;
                var rect = progressTrack.getBoundingClientRect();
                audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
            });
        }

        // Dismiss
        if (dismissBtn) {
            dismissBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                audio.pause();
                updateUI(false);
                if (audioBar) audioBar.classList.add('dismissed');
                return false;
            });
        }

        // NOTE: Autoplay intentionally removed.
        // Both players used to auto-start ~800ms after page load, so visitors
        // heard two narrations playing at the same time. Audio now starts ONLY
        // on an explicit click of the play button (toggleAudio above).

        return {
            pause: function() {
                if (!audio.paused) {
                    audio.pause();
                    updateUI(false);
                }
            }
        };
    }

    // Create both players — English first, then Bilingual
    var player2API = null; // forward ref

    var player1 = setupAudioPlayer({
        suffix: '1',
        label: 'English',
        delay: 0,
        onPlayStart: function() {
            if (player2API) player2API.pause();
        }
    });

    player2API = setupAudioPlayer({
        suffix: '2',
        label: 'Bilingual',
        delay: 200,
        onPlayStart: function() {
            if (player1) player1.pause();
        }
    });

    // ============================================
    // Nav scroll effect
    // ============================================
    const nav = document.getElementById('nav');
    const handleScroll = function() {
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
    // Contact form — "Contact the Author"
    // ------------------------------------------------------------
    // Every message is delivered to BOTH:
    //   Tony@RuDao.us          (author)
    //   com2000@agent.qq.com   (author's WorkBuddy / Agent Mail inbox)
    //
    // Delivery backends, tried in this order:
    //   1. Web3Forms  — free, no server required. Create one free access
    //      key per recipient at https://web3forms.com and paste them into
    //      web3formsKeys below. The free plan allows 1 recipient per form
    //      (unlimited forms), so two keys reach two inboxes.
    //   2. /api/contact — optional Cloudflare Pages Function (Resend).
    //   3. mailto: — if nothing is configured above, the visitor's own
    //      email app opens with both recipients pre-filled.
    // ============================================
    var CONTACT_CONFIG = {
        // Paste Web3Forms access keys here (see https://web3forms.com)
        web3formsKeys: [
            // 'YOUR_KEY_FOR_TONY_RUDAO_US',
            // 'YOUR_KEY_FOR_COM2000_AGENT_QQ_COM'
        ],
        web3formsEndpoint: 'https://api.web3forms.com/submit',
        // Optional Cloudflare Pages Function endpoint (see functions/api/contact.js)
        apiEndpoint: '/api/contact',
        recipients: ['Tony@RuDao.us', 'com2000@agent.qq.com']
    };

    var contactForm = document.getElementById('contactForm');
    if (contactForm) {
        var contactStatus = document.getElementById('contactStatus');
        var contactSubmit = document.getElementById('contactSubmit');
        var contactNameEl = document.getElementById('contactName');
        var contactEmailEl = document.getElementById('contactEmail');
        var contactMessageEl = document.getElementById('contactMessage');

        var setContactStatus = function(msg, kind) {
            if (!contactStatus) return;
            contactStatus.textContent = msg;
            contactStatus.className = 'contact-status' + (kind ? ' ' + kind : '');
        };

        var postJson = function(url, body) {
            return fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(body)
            }).then(function(res) {
                return res.json().catch(function() { return {}; }).then(function(data) {
                    return { ok: res.ok && (!data || data.success !== false), status: res.status };
                });
            });
        };

        var buildPayload = function() {
            var fields = {
                name: (contactNameEl && contactNameEl.value.trim()) || 'Anonymous visitor',
                email: contactEmailEl.value.trim(),
                message: contactMessageEl.value.trim(),
                subject: 'RuDao.us \u2014 new message from the contact form',
                from_name: 'RuDao.us Contact Form',
                page: window.location.href,
                to_recipients: CONTACT_CONFIG.recipients.join(', ')
            };
            return fields;
        };

        var sendViaWeb3Forms = function(fields) {
            var keys = CONTACT_CONFIG.web3formsKeys.filter(function(k) {
                return k && k.indexOf('YOUR_KEY') !== 0;
            });
            // Not configured yet -> let the caller fall through to the next backend
            if (!keys.length) return Promise.resolve({ ok: false, configured: false });
            var sends = keys.map(function(key) {
                var body = { access_key: key, botcheck: false };
                Object.keys(fields).forEach(function(k) { body[k] = fields[k]; });
                return postJson(CONTACT_CONFIG.web3formsEndpoint, body)
                    .then(function(r) { return !!r.ok; })
                    .catch(function() { return false; });
            });
            return Promise.all(sends).then(function(results) {
                var wins = results.filter(Boolean).length;
                return { ok: wins > 0, configured: true, delivered: wins, total: results.length };
            });
        };

        var sendViaApi = function(fields) {
            return postJson(CONTACT_CONFIG.apiEndpoint, {
                name: fields.name,
                email: fields.email,
                message: fields.message,
                page: fields.page
            }).then(function(r) {
                return { ok: !!r.ok, configured: r.status !== 404 && r.status !== 405 };
            }).catch(function() {
                return { ok: false, configured: false };
            });
        };

        var openMailtoFallback = function(fields) {
            var to = CONTACT_CONFIG.recipients.join(',');
            var subject = encodeURIComponent('RuDao.us \u2014 message from ' + fields.name);
            var body = encodeURIComponent(fields.message + '\n\n\u2014 ' + fields.name + ' (' + fields.email + ')');
            window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body;
            setContactStatus('Your email app is opening with the message ready to send\u2026 If nothing opens, email ' + CONTACT_CONFIG.recipients[0] + ' directly.', 'ok');
        };

        var resetContactForm = function() {
            contactForm.reset();
            contactSubmit.disabled = false;
            contactSubmit.textContent = 'Send Message \u00B7 \u53D1\u9001\u7559\u8A00';
        };

        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            var fields = buildPayload();
            var validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email);
            var validMessage = fields.message.length >= 5;

            contactEmailEl.classList.toggle('invalid', !validEmail);
            contactMessageEl.classList.toggle('invalid', !validMessage);

            if (!validEmail) {
                setContactStatus('Please enter a valid email address so Tony can reply. \u00B7 \u8BF7\u586B\u5199\u6709\u6548\u7684\u90AE\u7BB1\u5730\u5740\u3002', 'err');
                contactEmailEl.focus();
                return;
            }
            if (!validMessage) {
                setContactStatus('Please write a short message (a few words is enough). \u00B7 \u8BF7\u7A0D\u5FAE\u5199\u4E00\u4E9B\u5185\u5BB9\u3002', 'err');
                contactMessageEl.focus();
                return;
            }

            contactSubmit.disabled = true;
            contactSubmit.textContent = 'Sending\u2026';
            setContactStatus('Sending your message\u2026');

            sendViaWeb3Forms(fields)
                .then(function(res) {
                    if (res.configured) return res;
                    return sendViaApi(fields);
                })
                .then(function(res) {
                    if (!res.configured) {
                        // No backend configured yet -> never lose the visitor's message
                        resetContactForm();
                        openMailtoFallback(fields);
                        return;
                    }
                    if (!res.ok) throw new Error('send failed');
                    setContactStatus('\u2713 Thank you \u2014 your message has been sent to Tony Tong. \u00B7 \u60A8\u7684\u7559\u8A00\u5DF2\u9001\u8FBE\uFF0C\u611F\u8C22!', 'ok');
                    resetContactForm();
                })
                .catch(function() {
                    resetContactForm();
                    setContactStatus('Sending failed \u2014 please try again, or email ' + CONTACT_CONFIG.recipients[0] + ' directly. \u00B7 \u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u6216\u76F4\u63A5\u53D1\u90AE\u4EF6\u3002', 'err');
                });
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
    console.log('%cSix Parts \u00B7 Nine Chapters \u2014 RuDao.us', 'color: #c9a961;');
})();