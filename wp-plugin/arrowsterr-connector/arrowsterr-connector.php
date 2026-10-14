<?php
/**
 * Plugin Name:       Arrowsterr Connector
 * Plugin URI:        https://arrowsterr.com/
 * Description:       Lets Arrowsterr set SEO titles, meta descriptions and structured data on your posts and pages. Works with Yoast SEO and Rank Math, or on its own.
 * Version:           1.0.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            Arrowsterr
 * License:           GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
	exit;
}

define('ARROWSTERR_CONNECTOR_VERSION', '1.0.0');

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

add_action('rest_api_init', function () {
	// Arrowsterr checks this to know the plugin is installed and which SEO plugin it writes through.
	register_rest_route('arrowsterr/v1', '/status', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can('edit_posts');
		},
		'callback'            => function () {
			return array('version' => ARROWSTERR_CONNECTOR_VERSION, 'seo' => arrowsterr_seo_plugin());
		},
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
				return true;
			},
			'schema'          => array(
				'description' => 'SEO title, meta description and structured data set by Arrowsterr.',
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
