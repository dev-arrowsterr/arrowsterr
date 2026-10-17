<?php
/**
 * Plugin Name:       Arrowsterr Connector
 * Plugin URI:        https://arrowsterr.com/
 * Description:       Lets Arrowsterr publish articles with their interactive modules, and set SEO titles, meta descriptions and structured data on your posts and pages. Works with Yoast SEO and Rank Math, or on its own.
 * Version:           1.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Arrowsterr
 * License:           GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
	exit;
}

define('ARROWSTERR_CONNECTOR_VERSION', '1.1.0');
// The largest module Arrowsterr stores, in bytes. Modules are single HTML files with inline CSS and JS.
define('ARROWSTERR_MODULE_MAX', 500000);

/** The SEO plugin that owns titles and descriptions on this site, if any. */
function arrowsterr_seo_plugin() {
	if (defined('WPSEO_VERSION')) {
		return 'yoast';
	}
	if (defined('RANK_MATH_VERSION')) {
		return 'rankmath';
	}
	return 'none';
}

/** Where each value is stored, so edits show up in the SEO plugin people already use. */
function arrowsterr_keys() {
	switch (arrowsterr_seo_plugin()) {
		case 'yoast':
			return array('title' => '_yoast_wpseo_title', 'description' => '_yoast_wpseo_metadesc');
		case 'rankmath':
			return array('title' => 'rank_math_title', 'description' => 'rank_math_description');
		default:
			return array('title' => '_arrowsterr_title', 'description' => '_arrowsterr_description');
	}
}

// ─────────────── Interactive modules ───────────────
// Each module is stored in the post's meta (_arrowsterr_modules: id => title, html, height) and shown with
// [arrowsterr_module id="..."] or the Arrowsterr module block. It always runs in a sandboxed iframe
// (sandbox="allow-scripts", no same origin), so its scripts can't reach this site, its cookies or the page around it.

/** A module id: 1 to 64 letters, digits, - or _. */
function arrowsterr_module_id($id) {
	$id = (string) $id;
	return preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id) ? $id : '';
}

/** Clean one module sent by Arrowsterr. Null when it is not a valid module. */
function arrowsterr_clean_module($m) {
	if (!is_array($m)) {
		return null;
	}
	$id   = arrowsterr_module_id(isset($m['id']) ? $m['id'] : '');
	$html = isset($m['html']) ? (string) $m['html'] : '';
	if ($id === '' || $html === '' || strlen($html) > ARROWSTERR_MODULE_MAX) {
		return null;
	}
	// Valid UTF-8 only, and no null bytes.
	$html = str_replace("\0", '', wp_check_invalid_utf8($html));
	if ($html === '') {
		return null;
	}
	$height = isset($m['height']) ? (int) $m['height'] : 600;
	return array(
		'id'     => $id,
		'title'  => sanitize_text_field(isset($m['title']) ? (string) $m['title'] : ''),
		'html'   => $html,
		'height' => max(100, min(4000, $height)),
	);
}

/** The modules saved on a post, by id. */
function arrowsterr_post_modules($post_id) {
	$all = get_post_meta((int) $post_id, '_arrowsterr_modules', true);
	return is_array($all) ? $all : array();
}

/** The page a module runs in: its HTML and a small script that reports its height to this page. */
function arrowsterr_module_document($html) {
	$fit = '<script>(function(){function s(){parent.postMessage({awh:document.documentElement.scrollHeight},"*")}new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s)})()</script>';
	if (stripos($html, '</body>') !== false) {
		return preg_replace('~</body>~i', $fit . '</body>', $html, 1);
	}
	return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">' . $html . $fit . '</body>';
}

/** One module as a sandboxed iframe that sizes itself. Empty when the post has no such module. */
function arrowsterr_render_module($post_id, $id) {
	$id = arrowsterr_module_id($id);
	if ($id === '' || !$post_id) {
		return '';
	}
	$modules = arrowsterr_post_modules($post_id);
	if (!isset($modules[$id]) || !is_array($modules[$id]) || empty($modules[$id]['html'])) {
		return '';
	}
	$m = $modules[$id];
	arrowsterr_enqueue_resizer();
	// srcdoc is an attribute: every &, quote and angle bracket is encoded, including entities already in the HTML,
	// so the module arrives in its frame exactly as written and nothing can close the attribute or the tag.
	$doc    = htmlspecialchars(arrowsterr_module_document((string) $m['html']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8', true);
	$height = isset($m['height']) ? max(100, min(4000, (int) $m['height'])) : 600;
	$title  = !empty($m['title']) ? $m['title'] : __('Interactive module', 'arrowsterr-connector');
	return '<div class="arrowsterr-module"><iframe class="arrowsterr-module__frame" title="' . esc_attr($title) . '" sandbox="allow-scripts" loading="lazy" style="display:block;width:100%;border:0;height:' . $height . 'px" srcdoc="' . $doc . '"></iframe></div>';
}

/** The script that sets each module frame's height from the message its page sends. Once per page. */
function arrowsterr_enqueue_resizer() {
	if (wp_script_is('arrowsterr-modules', 'enqueued')) {
		return;
	}
	wp_register_script('arrowsterr-modules', false, array(), ARROWSTERR_CONNECTOR_VERSION, true);
	wp_enqueue_script('arrowsterr-modules');
	wp_add_inline_script('arrowsterr-modules', '(function(){addEventListener("message",function(e){if(!e.data||typeof e.data.awh!=="number")return;var f=document.querySelectorAll("iframe.arrowsterr-module__frame");for(var i=0;i<f.length;i++){if(f[i].contentWindow===e.source){f[i].style.height=Math.min(4000,Math.max(100,Math.ceil(e.data.awh)+4))+"px";}}});})();');
}

add_shortcode('arrowsterr_module', function ($atts) {
	$atts = shortcode_atts(array('id' => ''), $atts, 'arrowsterr_module');
	return arrowsterr_render_module(get_the_ID(), $atts['id']);
});

add_action('init', function () {
	// The block for people adding a module by hand in the block editor. Arrowsterr itself publishes the shortcode.
	wp_register_script('arrowsterr-module-block', false, array('wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-server-side-render', 'wp-i18n'), ARROWSTERR_CONNECTOR_VERSION, true);
	wp_add_inline_script('arrowsterr-module-block', <<<'JS'
(function (wp) {
	var el = wp.element.createElement, __ = wp.i18n.__;
	wp.blocks.registerBlockType('arrowsterr/module', {
		apiVersion: 2,
		title: __('Arrowsterr module', 'arrowsterr-connector'),
		description: __('An interactive module published from Arrowsterr.', 'arrowsterr-connector'),
		category: 'embed',
		icon: 'calculator',
		attributes: { id: { type: 'string', default: '' } },
		supports: { html: false },
		edit: function (props) {
			var bp = wp.blockEditor.useBlockProps();
			return el('div', bp,
				el(wp.blockEditor.InspectorControls, null,
					el(wp.components.PanelBody, { title: __('Module', 'arrowsterr-connector') },
						el(wp.components.TextControl, { label: __('Module id', 'arrowsterr-connector'), value: props.attributes.id, onChange: function (v) { props.setAttributes({ id: v }); } }))),
				props.attributes.id
					? el(wp.serverSideRender, { block: 'arrowsterr/module', attributes: props.attributes })
					: el(wp.components.Placeholder, { icon: 'calculator', label: __('Arrowsterr module', 'arrowsterr-connector') },
						el(wp.components.TextControl, { label: __('Module id', 'arrowsterr-connector'), value: props.attributes.id, onChange: function (v) { props.setAttributes({ id: v }); } })));
		},
		save: function () { return null; }
	});
})(window.wp);
JS
	);
	register_block_type('arrowsterr/module', array(
		'api_version'     => 2,
		'editor_script'   => 'arrowsterr-module-block',
		'attributes'      => array('id' => array('type' => 'string', 'default' => '')),
		'render_callback' => function ($attributes) {
			return arrowsterr_render_module(get_the_ID(), isset($attributes['id']) ? $attributes['id'] : '');
		},
	));
});

// ─────────────── REST API ───────────────

add_action('rest_api_init', function () {
	// Arrowsterr checks this to know the plugin is installed, its version and which SEO plugin it writes through.
	register_rest_route('arrowsterr/v1', '/status', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('edit_posts');
		},
		'callback'            => function () {
			return array('version' => ARROWSTERR_CONNECTOR_VERSION, 'seo' => arrowsterr_seo_plugin(), 'modules' => true);
		},
	));

	// The post Arrowsterr made for one of its articles, so a publish that was cut off never makes a second post.
	register_rest_route('arrowsterr/v1', '/find', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('edit_posts');
		},
		'args'                => array('doc' => array('required' => true, 'type' => 'string')),
		'callback'            => function (WP_REST_Request $request) {
			$doc = strtolower((string) $request->get_param('doc'));
			if (!preg_match('/^[a-f0-9-]{36}$/', $doc)) {
				return new WP_Error('arrowsterr_doc', 'Not an article id.', array('status' => 400));
			}
			$ids = get_posts(array(
				'post_type'        => 'post',
				'post_status'      => array('publish', 'future', 'draft', 'pending', 'private', 'trash'),
				'meta_key'         => '_arrowsterr_doc',
				'meta_value'       => $doc,
				'orderby'          => 'ID',
				'order'            => 'DESC',
				'fields'           => 'ids',
				'posts_per_page'   => 10,
				'suppress_filters' => true,
			));
			foreach ($ids as $id) {
				if (current_user_can('edit_post', $id)) {
					return array('id' => (int) $id, 'status' => get_post_status($id));
				}
			}
			return array('id' => null);
		},
	));

	// Save the interactive modules of a post. The list replaces what the post had.
	register_rest_route('arrowsterr/v1', '/posts/(?P<id>\d+)/modules', array(
		array(
			'methods'             => 'POST',
			'permission_callback' => function (WP_REST_Request $request) {
				return current_user_can('edit_post', (int) $request['id']);
			},
			'callback'            => function (WP_REST_Request $request) {
				$post_id = (int) $request['id'];
				if (!get_post($post_id)) {
					return new WP_Error('rest_post_invalid_id', 'Invalid post ID.', array('status' => 404));
				}
				$list = $request->get_param('modules');
				if (!is_array($list) || count($list) > 50) {
					return new WP_Error('arrowsterr_modules', 'Send up to 50 modules.', array('status' => 400));
				}
				$clean = array();
				foreach ($list as $m) {
					$c = arrowsterr_clean_module($m);
					if (!$c) {
						return new WP_Error('arrowsterr_module', 'A module is missing its id or HTML, or is too large.', array('status' => 400));
					}
					$clean[$c['id']] = array('title' => $c['title'], 'html' => $c['html'], 'height' => $c['height']);
				}
				if (!$clean) {
					delete_post_meta($post_id, '_arrowsterr_modules');
				} else {
					update_post_meta($post_id, '_arrowsterr_modules', wp_slash($clean));
				}
				return array('id' => $post_id, 'modules' => array_keys($clean));
			},
		),
		array(
			'methods'             => 'GET',
			'permission_callback' => function (WP_REST_Request $request) {
				return current_user_can('edit_post', (int) $request['id']);
			},
			'callback'            => function (WP_REST_Request $request) {
				$out = array();
				foreach (arrowsterr_post_modules((int) $request['id']) as $id => $m) {
					$out[] = array('id' => (string) $id, 'title' => isset($m['title']) ? $m['title'] : '', 'height' => isset($m['height']) ? (int) $m['height'] : 600);
				}
				return $out;
			},
		),
	));

	foreach (array('post', 'page') as $type) {
		register_rest_field($type, 'arrowsterr', array(
			'get_callback'    => function ($post) {
				$id   = (int) $post['id'];
				$keys = arrowsterr_keys();
				return array(
					'title'       => (string) get_post_meta($id, $keys['title'], true),
					'description' => (string) get_post_meta($id, $keys['description'], true),
					'schema'      => (string) get_post_meta($id, '_arrowsterr_schema', true),
					'doc'         => (string) get_post_meta($id, '_arrowsterr_doc', true),
				);
			},
			'update_callback' => function ($value, $post) {
				if (!is_array($value) || !current_user_can('edit_post', $post->ID)) {
					return new WP_Error('arrowsterr_forbidden', 'You cannot edit this post.', array('status' => 403));
				}
				$keys = arrowsterr_keys();
				foreach (array('title', 'description') as $field) {
					if (!array_key_exists($field, $value)) {
						continue;
					}
					$text = sanitize_text_field((string) $value[$field]);
					if ($text === '') {
						delete_post_meta($post->ID, $keys[$field]);
					} else {
						update_post_meta($post->ID, $keys[$field], wp_slash($text));
					}
				}
				if (array_key_exists('schema', $value)) {
					$raw = trim((string) $value['schema']);
					if ($raw === '') {
						delete_post_meta($post->ID, '_arrowsterr_schema');
					} else {
						$data = json_decode($raw, true);
						if (!is_array($data)) {
							return new WP_Error('arrowsterr_schema', 'Structured data must be valid JSON.', array('status' => 400));
						}
						update_post_meta($post->ID, '_arrowsterr_schema', wp_slash(wp_json_encode($data, JSON_UNESCAPED_UNICODE)));
					}
				}
				// The Arrowsterr article this post was made from (find, above).
				if (array_key_exists('doc', $value)) {
					$doc = strtolower((string) $value['doc']);
					if (preg_match('/^[a-f0-9-]{36}$/', $doc)) {
						update_post_meta($post->ID, '_arrowsterr_doc', $doc);
					}
				}
				return true;
			},
			'schema'          => array(
				'description' => 'SEO title, meta description and structured data set by Arrowsterr, and the Arrowsterr article the post came from.',
				'type'        => 'object',
				'context'     => array('edit'),
			),
		));
	}
});

// With Yoast or Rank Math, they print the title and description. On their own, this plugin does.
add_filter('pre_get_document_title', function ($title) {
	if (arrowsterr_seo_plugin() !== 'none' || !is_singular()) {
		return $title;
	}
	$custom = get_post_meta(get_queried_object_id(), '_arrowsterr_title', true);
	return $custom !== '' ? $custom : $title;
}, 20);

add_action('wp_head', function () {
	if (!is_singular()) {
		return;
	}
	$id = get_queried_object_id();
	if (arrowsterr_seo_plugin() === 'none') {
		$description = get_post_meta($id, '_arrowsterr_description', true);
		if ($description !== '') {
			echo '<meta name="description" content="' . esc_attr($description) . '" />' . "\n";
		}
	}
	$schema = get_post_meta($id, '_arrowsterr_schema', true);
	if ($schema !== '') {
		$data = json_decode($schema, true);
		if (is_array($data)) {
			// wp_json_encode escapes slashes, so the JSON can't close the script tag.
			echo '<script type="application/ld+json">' . wp_json_encode($data) . '</script>' . "\n";
		}
	}
}, 5);
