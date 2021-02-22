(function () {
    var i, text, code, codes = document.getElementsByTagName('code');
    for (i = 0;
        i < codes.length;
    ) {
        code = codes[i];
        if (code.parentNode.tagName !== 'PRE' && code.childElementCount === 0) {
            text = code.textContent;
            if (/^\$[^$]/.test(text) && /[^$]\$$/.test(text)) {
                text = text.replace(/^\$/, '\\(').replace(/\$$/, '\\)');
                code.textContent = text;
            }
            if (/^\\\((.|\s)+\\\)$/.test(text) || /^\\\[(.|\s)+\\\]$/.test(text) ||
                /^\$(.|\s)+\$$/.test(text) ||
                /^\\begin\{([^}]+)\}(.|\s)+\\end\{[^}]+\}$/.test(text)) {
                code.outerHTML = code.innerHTML;  // remove <code></code>
                continue;
            }
        }
        i++;
    }
})();

function menuFixed(id) {
    var obj = document.getElementById(id);
    if (obj == null) {
        return;
    }
    var _getHeight = obj.offsetTop;

    window.onscroll = function () {
        changePos(id, _getHeight);
    }
}

function changePos(id, height) {
    var obj = document.getElementById(id);
    var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    if (scrollTop < height) {
        obj.style.position = 'absolute';
        obj.style.top = '90px';
    } else {
        obj.style.position = 'fixed';
        obj.style.top = '10px';
    }
}

window.onload = function () {
    menuFixed('article-toc');
}
