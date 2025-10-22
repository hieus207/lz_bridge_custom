    const webpack = require('webpack');

    module.exports = {
      webpack: {
        configure: (webpackConfig) => {
          webpackConfig.resolve.fallback = {
            ...webpackConfig.resolve.fallback,
            process: require.resolve('process/browser'),
            zlib: require.resolve('browserify-zlib'),
            stream: require.resolve('stream-browserify'),
            util: require.resolve('util'),
            buffer: require.resolve('buffer'),
            assert: require.resolve('assert'),
          };

          webpackConfig.plugins = [
            ...webpackConfig.plugins,
            new webpack.ProvidePlugin({
              Buffer: ['buffer', 'Buffer'],
              process: 'process/browser',
            }),
          ];

          // Optional: If you're dealing with .mjs files or modules with "type": "module"
          // in their package.json, you might need this rule for fully specified imports.
          webpackConfig.module.rules.push({
            test: /\.m?js$/,
            resolve: {
              fullySpecified: false,
            },
          });

          return webpackConfig;
        },
      },
    };