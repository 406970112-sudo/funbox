# Online meme provider attribution

Provider endpoint discovery and field/selector mappings were adapted from
[o98k-ok/meme](https://github.com/o98k-ok/meme), whose README declares **MIT**.
Upstream author/project: o98k-ok, meme. The consulted upstream files contain the README license declaration but no
separate license text or copyright notice; this notice preserves the available
attribution and license declaration without inventing an upstream copyright.

The local implementation replaces the original network stack with verified TLS,
bounded reads, public-IP-only DNS-pinned dialing, redirect checks, scoped cookies,
and ID-based media registration. It does not use upstream image proxy settings.

MIT code licensing does not grant rights to images returned by third-party sites.
Image rights remain with their original authors; source attribution is retained
on online records. Sources may block requests or stop working independently.
