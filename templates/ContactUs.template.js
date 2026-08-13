// Contact-form handler. Rendered to js/ContactUs.js by scripts/build-contact-js.js,
// which substitutes site.recaptcha_site_key AND the field contract from
// scripts/form-contract.js into the constants below. Do not hand-edit the rendered copy.
//
// The handler is ADAPTIVE: it reads whichever input `name`s each form actually
// uses (per the injected contract) rather than assuming a fixed set — so a form
// with a single name="username" and a form with separate first_name/last_name
// both work without any change to the markup.
const RECAPTCHA_SITEKEY = "%%RECAPTCHA_SITE_KEY%%";
const FORM_CONTRACT = %%FIELD_CONTRACT%%; // { FIELDS: [...], HONEYPOT: "website" }

// First matching input's trimmed value, trying each name in order. Works for
// input / textarea / select alike.
function readField(form, aliases) {
    for (const name of aliases || []) {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) return (el.value ?? "").trim();
    }
    return "";
}

async function onSubmit(event) {
    if (event) event.preventDefault();
    const form = event?.target?.closest("form");
    if (!form) return;

    // Name: prefer separate given/family inputs, else a single whole-name field.
    const nameField = FORM_CONTRACT.FIELDS.find((f) => f.key === "name");
    const given  = readField(form, nameField.parts.given);
    const family = readField(form, nameField.parts.family);
    const whole  = readField(form, nameField.whole);
    const username = [given, family].filter(Boolean).join(" ").trim() || whole;
    // The worker email prints "First Name: {first_name} {last_name}", so with a
    // single name field put the whole value in first_name and leave last_name
    // empty — the email still reads correctly.
    const first_name = given || whole;
    const last_name  = family;

    const valueFor = (key) => {
        const f = FORM_CONTRACT.FIELDS.find((x) => x.key === key);
        return f ? readField(form, f.aliases) : "";
    };
    const emailaddress  = valueFor("emailaddress");
    const telephone     = valueFor("telephone");
    const sendermessage = valueFor("sendermessage");
    const service       = valueFor("service");
    const website       = readField(form, [FORM_CONTRACT.HONEYPOT]); // honeypot

    if (!username || !emailaddress || !telephone || !sendermessage) {
        alert("Please complete the form");
        return;
    }

    if (typeof grecaptcha === "undefined") {
        alert("Captcha has not loaded. Please refresh and try again.");
        return;
    }

    let token = "";
    try {
        token = await new Promise((resolve, reject) => {
            grecaptcha.ready(() => {
                grecaptcha.execute(RECAPTCHA_SITEKEY, { action: "submit" }).then(resolve, reject);
            });
        });
    } catch (err) {
        alert("Captcha verification failed. Please try again.");
        return;
    }

    const payload = {
        username, emailaddress, telephone, sendermessage,
        first_name, last_name, service, website, token,
    };

    try {
        const response = await fetch("/PHPFORMS/contact-form", {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) {
            let message = `Submission failed (${response.status})`;
            try {
                const data = await response.json();
                if (data && data.error) message = data.error;
            } catch (_) {}
            alert(message);
            return;
        }
        window.location.href = "/thank-you.html";
    } catch (error) {
        alert(error.message);
    }
}
